"use client"

import Link from "next/link"
import { useRef, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RequestError } from "@/components/session-recovery"
import { useNavigationGuard } from "@/components/navigation-guard"
import { useResource } from "@/features/operations/use-operation"
import { referenceConfigs, type ReferenceKind, type ReferenceList } from "@/features/reference-data/reference-config"
import { paymentMeans, type FinancialSettingsSnapshot } from "./use-suggested-payment-method"

const kinds: ReferenceKind[] = ["contas-financeiras", "categorias-financeiras", "formas-pagamento"]

function Catalog({ kind }: { kind: ReferenceKind }) {
  const config = referenceConfigs[kind]
  const resource = useResource<ReferenceList>(`/api/erp/${config.endpoint}?limit=1`)
  return <article className="form-section min-w-0 space-y-3"><h3 className="font-semibold">{config.title}</h3><p className="text-sm text-muted-foreground">{config.description}</p>
    {resource.loading ? <p role="status">Consultando cadastros…</p> : resource.error ? <div className="space-y-2"><p role="alert"><RequestError message={resource.error} status={resource.status} /></p><Button variant="outline" onClick={resource.reload}>Tentar novamente: {config.title}</Button></div> : resource.value && <><p>{resource.value.total} registro(s) · {resource.value.canEdit ? "Consulta e edição" : "Somente consulta"}</p><Link className="inline-flex min-h-11 items-center font-medium text-primary underline" href={`/cadastros/${kind}`}>Abrir {config.title.toLocaleLowerCase("pt-BR")}</Link></>}
  </article>
}

export function FinancialSettings() {
  const resource = useResource<FinancialSettingsSnapshot>("/api/erp/financial-settings")
  const [draft, setDraft] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const pending = useRef(false)
  const method = draft ?? resource.value?.data.defaultPaymentMethod ?? "bank_transfer"
  const dirty = !!resource.value && method !== resource.value.data.defaultPaymentMethod
  useNavigationGuard(dirty ? "Sair e descartar a configuração financeira não salva?" : null)
  async function save() {
    if (!resource.value?.canEdit || !resource.etag || !dirty || blocked || pending.current) return
    pending.current = true; setBusy(true); setMessage(""); setError("")
    try {
      const response = await fetch("/api/erp/financial-settings", { method: "PUT", headers: { "Content-Type": "application/json", "X-Tenant-Id": resource.value.tenantId, "If-Match": resource.etag }, body: JSON.stringify({ defaultPaymentMethod: method }) })
      const result = await response.json()
      if (!response.ok) throw Error(result.title || "Não foi possível salvar a configuração")
      if (result.tenantId !== resource.value.tenantId || result.data?.defaultPaymentMethod !== method || !response.headers.get("etag")) throw Error("Confirmação incompleta; recarregue para conferir.")
      setDraft(null); setMessage("Configuração salva no servidor para esta empresa."); resource.reload()
    } catch (reason) { setBlocked(true); setError(reason instanceof Error ? reason.message : "Falha de gravação. Recarregue antes de tentar novamente.") }
    finally { pending.current = false; setBusy(false) }
  }
  function reload() {
    if (dirty && !window.confirm("Recarregar e descartar sua alteração financeira?")) return
    setDraft(null); setBlocked(false); setError(""); setMessage(""); resource.reload()
  }
  const filtered = kinds.filter(kind => `${referenceConfigs[kind].title} ${referenceConfigs[kind].description}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")))
  return <div className="mx-auto max-w-6xl space-y-6 px-4 pb-28 pt-8 lg:px-6">
    <PageHeader eyebrow="Preferências / Financeiro" title="Configurações financeiras" description="Cadastros da empresa ativa e sugestões para preencher operações manuais." />
    <section className="form-section space-y-4" aria-labelledby="payment-default-title">
      <h2 id="payment-default-title" className="text-lg font-semibold">Baixas manuais</h2><p className="text-sm text-muted-foreground">O meio sugerido preenche novos formulários de contas a pagar e a receber. Pode ser alterado em cada operação. Não registra baixa, movimenta banco ou altera lançamentos anteriores.</p>
      {resource.loading && <p role="status">Carregando configuração…</p>}
      {resource.error && <div className="space-y-3"><p role="alert"><RequestError message={resource.error} status={resource.status} /></p><Button variant="outline" onClick={reload}>Tentar novamente</Button></div>}
      {resource.value && <><label className="grid max-w-md gap-2 text-sm">Meio sugerido nas baixas manuais<select className="h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3" disabled={!resource.value.canEdit || busy || blocked || resource.loading} value={method} onChange={event => setDraft(event.target.value)}>{Object.entries(paymentMeans).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <p className="text-sm text-muted-foreground">{resource.value.canEdit ? "Alteração exige permissão de gestão da empresa." : "Somente consulta. Solicite gestão da empresa para alterar."}</p>
        {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
        <div className="flex flex-wrap gap-3">{resource.value.canEdit && <Button disabled={!dirty || blocked || busy || resource.loading} onClick={save}>{busy ? "Salvando…" : "Salvar configuração financeira"}</Button>}<Button variant="outline" disabled={busy || resource.loading} onClick={reload}>Recarregar configuração</Button></div>
      </>}
    </section>
    <section className="space-y-4" aria-labelledby="financial-catalogs-title"><h2 id="financial-catalogs-title" className="text-lg font-semibold">Cadastros financeiros</h2><label className="grid max-w-md gap-2 text-sm">Buscar configurações financeiras<Input type="search" value={query} onChange={event => setQuery(event.target.value)} maxLength={120} /></label><div className="grid gap-4 lg:grid-cols-3">{filtered.map(kind => <Catalog key={kind} kind={kind} />)}</div>{!filtered.length && <p role="status">Nenhuma configuração encontrada.</p>}</section>
    <section className="form-section space-y-2"><h2 className="font-semibold">Recursos ainda indisponíveis</h2><p className="text-sm text-muted-foreground">Condições de parcelamento, centros de custos e regras de comissão ainda não possuem configuração operacional nesta tela. Contas e categorias não calculam saldos; formas cadastradas e seus prazos são referências e ainda não são vinculados automaticamente às baixas.</p></section>
  </div>
}
