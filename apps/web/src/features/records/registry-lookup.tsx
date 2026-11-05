"use client"

import { useEffect, useRef, useState } from "react"
import type { Schema } from "@/lib/api/types"
import { erpFetch } from "@/lib/api/client"
import { Button } from "@/components/ui/button"

type Reply = Schema<"LookupReply">
type Kind = Schema<"LookupKind">
type Context = Schema<"LookupContext">
const labels: Record<string, string> = { postalCode: "CEP", state: "UF", city: "Cidade", street: "Rua", district: "Bairro", legalName: "Razão social", tradeName: "Nome fantasia", number: "Número", complement: "Complemento", cnae: "CNAE", activityDescription: "Atividade", stateRegistration: "Inscrição estadual", companySize: "Porte", taxRegime: "Regime informado pela fonte", email: "E-mail", phone: "Telefone" }
const normalized = (value: string) => value.trim().replace(/[.\s/-]/g, "").toUpperCase()
const date = (value: string) => Number.isNaN(Date.parse(value)) ? "Data não informada" : new Date(value).toLocaleString("pt-BR")

export function RegistryLookup({ kind, context, tenantId, readValue, readState, onApply, disabled = false }: {
  kind: Kind; context: Context; tenantId: string; readValue: () => string; readState?: () => string;
  onApply: (fields: Record<string, string>) => number; disabled?: boolean;
}) {
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<{ reply: Reply; key: string } | null>(null)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const active = useRef<AbortController | null>(null)
  const current = useRef({ readValue, readState, onApply, disabled, tenantId })
  useEffect(() => { current.current = { readValue, readState, onApply, disabled, tenantId } })
  useEffect(() => () => active.current?.abort(), [])
  const label = kind === "cep" ? "CEP" : kind === "ie" ? "IE" : "CNPJ"

  function key() {
    return JSON.stringify([kind, context, current.current.tenantId, normalized(current.current.readValue()), kind === "ie" ? current.current.readState?.().toUpperCase() : null])
  }

  async function lookup() {
    if (current.current.disabled || active.current) return
    const value = current.current.readValue()
    if (!value.trim()) { setError(`Informe ${label === "IE" ? "o CNPJ e a UF" : `o ${label}`} antes de consultar`); return }
    const captured = key()
    const controller = new AbortController()
    active.current = controller
    setPending(true); setResult(null); setMessage(""); setError("")
    try {
      const response = await erpFetch("/api/erp/registry-lookups", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": current.current.tenantId },
        body: JSON.stringify({ kind, context, value, ...(kind === "ie" ? { state: current.current.readState?.() } : {}) }),
        signal: controller.signal,
      })
      const reply = await response.json()
      if (!response.ok) throw new Error(reply.title || "Consulta indisponível. Continue manualmente")
      if (captured !== key() || reply.tenantId !== current.current.tenantId || normalized(reply.value || "") !== normalized(value) || reply.kind !== kind) {
        setMessage("O documento, CEP ou empresa mudou. Consulte novamente; os campos foram preservados"); return
      }
      if (reply.status !== "found" || !reply.data) {
        setMessage(reply.warnings?.join(" ") || "Sem resultado disponível. Continue manualmente"); return
      }
      if (!reply.source || !reply.expiresAt || !Number.isFinite(Date.parse(reply.expiresAt))) throw new Error("Prévia sem origem ou validade. Continue manualmente")
      setResult({ reply, key: captured })
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Consulta indisponível. Continue manualmente")
    } finally { if (active.current === controller) { active.current = null; setPending(false) } }
  }

  async function apply(fields: Record<string, string>) {
    if (!result || current.current.disabled || active.current) return
    const preview = result
    function validPreview() {
      if (key() !== preview.key || preview.reply.tenantId !== current.current.tenantId) {
        setResult(null); setMessage("O documento, CEP ou empresa mudou. Consulte novamente; os campos foram preservados"); return false
      }
      if (!preview.reply.expiresAt || Date.parse(preview.reply.expiresAt) <= Date.now()) {
        setResult(null); setMessage("A prévia venceu. Consulte novamente; os campos foram preservados"); return false
      }
      return true
    }
    if (!validPreview()) return
    const controller = new AbortController()
    active.current = controller
    setPending(true); setError("")
    try {
      // Another tab can replace the shared session cookie without changing this form's props.
      const response = await erpFetch("/api/erp/me", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
      const session: Schema<"CurrentAccessResponse"> = await response.json()
      if (!response.ok || session?.tenant?.id !== preview.reply.tenantId) {
        setResult(null); setMessage("A empresa da sessão mudou ou o acesso expirou. Recarregue antes de preencher; seus campos foram preservados"); return
      }
      if (current.current.disabled || !validPreview()) return
      const count = current.current.onApply(Object.fromEntries(Object.entries(fields).filter(([field, value]) => labels[field] && typeof value === "string" && value.trim())))
      setResult(null); setMessage(count ? "Campos vazios preenchidos. Dados já informados foram preservados; revise antes de salvar" : "Nenhum campo vazio para preencher. Seus dados foram preservados")
    } catch {
      if (!controller.signal.aborted) setError("Não foi possível conferir a empresa da sessão. Recarregue antes de preencher; seus campos foram preservados")
    } finally {
      if (active.current === controller) { active.current = null; setPending(false) }
    }
  }

  return <div className="col-span-full min-w-0 space-y-3 rounded-lg border border-border p-3">
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" disabled={disabled || pending} onClick={lookup}>{pending ? `Consultando ${label}…` : `Consultar ${label}`}</Button>
      <p className="min-w-0 text-sm text-muted-foreground">{kind === "ie" ? "Consulta cadastral não determina a condição de contribuinte." : "Confira a prévia para preencher somente campos vazios."} Você pode preencher manualmente.</p>
    </div>
    {pending && <p role="status">Conferindo os dados da consulta de {label}…</p>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="break-words text-sm">{message}</p>}
    {result && <section aria-label={`Prévia da consulta de ${label}`} className="min-w-0 space-y-3">
      <p role="status" className="break-words text-sm">Fonte: {result.reply.source} · Consultado em {date(result.reply.fetchedAt)}{result.reply.cached ? " · Cache" : ""}{result.reply.expiresAt ? ` · Cache até ${date(result.reply.expiresAt)}` : ""}</p>
      <p className="text-sm text-muted-foreground">Atualização na fonte: {result.reply.sourceUpdatedAt ? date(result.reply.sourceUpdatedAt) : "não informada"}.</p>
      {result.reply.warnings.map((warning, index) => <p className="break-words text-sm" key={index}>{warning}</p>)}
      <dl className="grid min-w-0 gap-3 sm:grid-cols-2">{Object.entries(result.reply.data!.fields).filter(([field]) => labels[field]).map(([field, value]) => <div className="min-w-0" key={field}><dt className="text-sm text-muted-foreground">{labels[field]}</dt><dd className="break-words">{value}</dd></div>)}</dl>
      {Object.keys(result.reply.data!.fields).length > 0 && <Button type="button" disabled={disabled || pending} onClick={() => apply(result.reply.data!.fields)}>Preencher campos vazios</Button>}
      {result.reply.data!.stateRegistrations.map((registration, index) => <div className="min-w-0 space-y-2" key={index}>
        <p className="break-words text-sm">{registration.state}: {registration.number} · {registration.active === true ? "Ativa na base consultada" : registration.active === false ? "Inativa na base consultada" : "Situação não informada"}</p>
        <Button type="button" variant="outline" disabled={disabled || pending} onClick={() => apply({ stateRegistration: registration.number })}>Usar inscrição {registration.state} {registration.number}</Button>
      </div>)}
      <Button type="button" variant="ghost" disabled={pending} onClick={() => setResult(null)}>Dispensar prévia</Button>
    </section>}
  </div>
}
