"use client"

import { erpFetch } from "@/lib/api/client"
import type { Schema } from "@/lib/api/types"

import Link from "next/link"
import { accessHref, safeReturnTo } from "@/lib/return-to"
import { AccessLink } from "@/components/feedback/session-recovery"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react"

function companySelectionError(status: number, title?: string) {
  if (status === 401) return "Sua sessão expirou. Entre novamente para continuar."
  if (status === 403) return "Seu acesso a esta empresa não foi autorizado."
  if (status === 503) return "O serviço de empresas está temporariamente indisponível. Tente novamente."
  return title || "Não foi possível selecionar esta empresa. Tente novamente."
}

export function CompanyPicker() {
  const router = useRouter()
  const returnTo = safeReturnTo(useSearchParams().get("returnTo"))
  const [companies, setCompanies] = useState<(Schema<"CompanySummary"> & { status?: string })[]>([])
  const [platformAdministrator, setPlatformAdministrator] = useState(false)
  const [feedback, setFeedback] = useState({ message: "Carregando suas empresas…", error: false })
  const [busyCompanyId, setBusyCompanyId] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    erpFetch("/api/erp/companies", { cache: "no-store" }).then(async response => {
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { title?: string }
        const message = response.status === 401
          ? "Sua sessão expirou. Entre novamente para continuar."
          : response.status === 403
            ? "Seu acesso às empresas não foi autorizado."
            : response.status === 503
              ? "O serviço de empresas está temporariamente indisponível. Tente novamente."
              : result.title || "Não foi possível consultar suas empresas"
        throw new Error(message)
      }
      const body = await response.json()
      if (active) { setCompanies(body.data); setPlatformAdministrator(body.platformAdministrator === true); setFeedback({ message: body.data.length ? "Selecione a empresa que deseja acessar" : body.platformAdministrator === true ? "Nenhuma empresa disponível" : "Você ainda não possui empresas cadastradas", error: false }) }
    }).catch(error => { if (active) setFeedback({ message: error.message, error: true }) })
    return () => { active = false }
  }, [])
  async function select(company: Schema<"CompanySummary"> & { status?: string }) {
    const name = company.tradeName || company.legalName
    setBusyCompanyId(company.id)
    setFeedback({ message: `Acessando ${name}…`, error: false })
    try {
      const response = await fetch("/api/auth/company", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId: company.id }), signal: AbortSignal.timeout(10000) })
      const result = await response.json().catch(() => ({})) as { title?: string; tenantId?: unknown }
      if (!response.ok) throw new Error(companySelectionError(response.status, result.title))
      if (result.tenantId !== company.id) throw new Error("A empresa selecionada não foi confirmada. Atualize a lista e tente novamente.")
      router.push(returnTo)
      router.refresh()
    } catch (error) {
      const timedOut = error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)
      setFeedback({ message: timedOut ? "A seleção demorou mais que o esperado. Tente novamente." : error instanceof Error ? error.message : "Não foi possível selecionar esta empresa. Tente novamente.", error: true })
      setBusyCompanyId(null)
    }
  }
  const busy = busyCompanyId !== null
  return <section className="form-section space-y-4" aria-busy={busy}>
    {platformAdministrator && <p className="font-medium">Administração da plataforma — todas as empresas do ERP. O acesso à empresa selecionada será registrado.</p>}
    <p id="company-picker-feedback" role={feedback.error ? "alert" : "status"} aria-live={feedback.error ? "assertive" : "polite"}>{feedback.message}</p>
    {companies.map(company => <button aria-describedby="company-picker-feedback" disabled={busy || (!!company.status && company.status !== "active")} type="button" className="block w-full rounded-xl border px-4 py-3 text-left disabled:opacity-50" key={company.id} onClick={() => void select(company)}><span className="block font-medium">{company.tradeName || company.legalName}</span>{company.tradeName && <span className="block text-sm text-muted-foreground">{company.legalName}</span>}{busyCompanyId === company.id && <span className="block text-sm">Acessando…</span>}{company.status && company.status !== "active" && <span className="block text-sm">{company.status === "suspended" ? "Suspensa" : "Arquivada"} — acesso indisponível</span>}</button>)}
    <Link className="inline-block underline" href={"/cadastro/empresa?" + new URLSearchParams({ returnTo })}>Cadastrar nova empresa</Link>
    <AccessLink className="ml-4 inline-block underline" />
  </section>
}

const subscribe = () => () => {}

export function CompanySignup() {
  const router = useRouter()
  const returnTo = safeReturnTo(useSearchParams().get("returnTo"))
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false)
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState(false)
  // Retain the key across ambiguous network failures; changing the payload gets a new key.
  const command = useRef<{ body: string; key: string } | null>(null)
  const [created, setCreated] = useState<string | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setStatus("Salvando cadastro…")
    const values = new FormData(event.currentTarget)
    const data = Object.fromEntries(values)
    const body = JSON.stringify({ ...data, segments: values.getAll("segments") })
    if (!command.current || command.current.body !== body) command.current = { body, key: crypto.randomUUID() }
    try {
      let tenantId = created
      if (!tenantId) {
        const response = await fetch("/api/erp/companies", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": command.current.key }, body })
        const result = await response.json()
        if (!response.ok) throw new Error([result.title, ...(result.errors || []).map((error: { field: string; message: string }) => `${error.field}: ${error.message}`)].join(". "))
        tenantId = result.tenantId
        setCreated(tenantId)
      }
      const selected = await fetch("/api/auth/company", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId }) })
      const selectedResult = await selected.json().catch(() => ({})) as { title?: string; tenantId?: unknown }
      if (!selected.ok) {
        const selectionFailure = [401, 403, 503].includes(selected.status)
          ? companySelectionError(selected.status, selectedResult.title)
          : selectedResult.title || "Empresa cadastrada. Acesse Suas empresas para selecioná-la"
        throw new Error(selectionFailure)
      }
      if (selectedResult.tenantId !== tenantId) throw new Error("A empresa cadastrada não foi confirmada. Acesse Suas empresas para tentar novamente.")
      router.push(returnTo)
      router.refresh()
    } catch (error) { setStatus(error instanceof Error ? error.message : "Não foi possível concluir. Tente novamente"); setBusy(false) }
  }
  const fields = [["legalName", "Nome empresarial"], ["tradeName", "Nome fantasia"], ["taxId", "CPF ou CNPJ"], ["postalCode", "CEP"], ["city", "Cidade"], ["street", "Rua"], ["number", "Número"], ["district", "Bairro"], ["email", "E-mail da empresa"]]
  return <form onSubmit={submit} className="form-section space-y-4">
    <p>Cadastre sua empresa com sua conta Ávila Ops. Você será o administrador desta empresa.</p>
    <fieldset disabled={!hydrated || busy || Boolean(created)} className="grid gap-4 sm:grid-cols-2">
      {fields.map(([name, label]) => <label className="field" key={name}>{label}<input name={name} maxLength={300} type={name === "email" ? "email" : "text"} required={!["tradeName", "email"].includes(name)} /></label>)}
      <label className="field">Tipo de pessoa<select name="personType" defaultValue="juridica"><option value="juridica">Pessoa jurídica</option><option value="fisica">Pessoa física</option></select></label>
      <label className="field">Regime tributário<select name="taxRegime" required defaultValue=""><option value="" disabled>Selecione</option><option value="simples">Simples Nacional</option><option value="presumido">Lucro presumido</option><option value="real">Lucro real</option></select></label>
      <label className="field">UF<select aria-label="UF" name="state" required defaultValue=""><option value="" disabled>Selecione</option>{"AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ").map(state => <option key={state}>{state}</option>)}</select></label>
      <label className="field">Segmento<select aria-label="Segmento" name="segments" required defaultValue=""><option value="" disabled>Selecione</option>{["Comércio", "E-commerce", "Serviços", "Indústria"].map(segment => <option key={segment}>{segment}</option>)}</select></label>
    </fieldset>
    <p role="status" aria-live="polite">{status}</p>
    <button type="submit" disabled={!hydrated || busy} className="rounded-xl bg-primary px-4 py-3 text-primary-foreground">{busy ? "Salvando…" : created ? "Acessar empresa cadastrada" : "Cadastrar empresa"}</button>
    <Link href={accessHref("/empresas", returnTo)} className="ml-4 underline">Suas empresas</Link>
  </form>
}
