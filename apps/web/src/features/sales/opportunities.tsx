"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RequestError } from "@/components/feedback/session-recovery"
import { useCommand, useResource } from "@/hooks/use-operation"
import { useNavigationGuard } from "@/components/shell/navigation-guard"
import { RegistryLookup } from "@/features/records/registry-lookup"
import { Lookup, type Choice } from "./orders"
import { money, inputAmount, parseAmount } from "./negotiation-types"

export const pipelineStages = { new: "Novo", contacted: "Contato feito", proposed: "Proposta enviada", negotiation: "Negociação", won: "Ganho", lost: "Perdido" }
type Stage = keyof typeof pipelineStages
export type Opportunity = { id: string; revision: number; title: string; estimatedCents: number; stage: Stage; customerId: string | null; customerName: string | null; companyName: string; companyTaxId: string; contactName: string; phone: string; email: string; source: string; notes: string; orderId: string | null; proposalId: string | null }
type Snapshot = { tenantId: string; canEdit: boolean; data: Opportunity }
type Listing = { tenantId: string; canEdit: boolean; data: Opportunity[]; total: number; totals: { stage: Stage; count: number; estimatedCents: number }[] }

export function SalesPipeline() {
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState({ q: "", stage: "", offset: 0 })
  const params = new URLSearchParams({ q: query.q, stage: query.stage, offset: String(query.offset), limit: "100" })
  const result = useResource<Listing>(`/api/erp/opportunities?${params}`)
  const open = result.value?.totals.filter(t => t.stage !== "won" && t.stage !== "lost") || []
  return <main className="mx-auto min-w-0 max-w-7xl space-y-5 px-4 pb-24 pt-6"><PageHeader eyebrow="Vendas" title="Funil comercial" description="Registre oportunidades antes do pedido, inclusive quando a empresa ainda não é cliente." />
    <div className="flex flex-wrap justify-between gap-3"><p>{open.reduce((sum, t) => sum + t.count, 0)} em andamento · {money(open.reduce((sum, t) => sum + t.estimatedCents, 0))}</p>{result.value?.canEdit && <Link className="rounded-lg border px-4 py-2 text-primary" href="/vendas/funil/nova">Nova oportunidade</Link>}</div>
    <form className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]" onSubmit={e => { e.preventDefault(); setQuery({ ...query, q: search.trim(), offset: 0 }) }}><label className="grid min-w-0 flex-1 gap-2">Buscar oportunidade, empresa ou contato<Input type="search" maxLength={160} value={search} onChange={e => setSearch(e.target.value)} /></label><label className="grid gap-2">Etapa<select className="min-h-10 rounded-lg border bg-background px-3" value={query.stage} onChange={e => setQuery({ ...query, stage: e.target.value, offset: 0 })}><option value="">Todas as etapas</option>{Object.entries(pipelineStages).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><Button type="submit">Buscar</Button></form>
    {result.loading ? <p role="status">Carregando oportunidades…</p> : result.error ? <p role="alert"><RequestError message={result.error} status={result.status} /></p> : <>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">{Object.entries(pipelineStages).filter(([stage]) => query.stage ? stage === query.stage : stage !== "won" && stage !== "lost").map(([stage, label]) => {
        const rows = result.value?.data.filter(item => item.stage === stage) || []
        return <section key={stage} className="min-w-0 space-y-3 rounded-xl border bg-muted/20 p-3"><h2 className="font-semibold">{label} · {rows.length}</h2>{rows.length ? rows.map(item => <article key={item.id} className="min-w-0 space-y-2 rounded-lg border bg-background p-3"><Link className="break-words font-medium text-primary underline" href={`/vendas/funil/${item.id}`}>{item.title}</Link><p className="break-words text-sm">{item.customerName || item.companyName}</p><p>{money(item.estimatedCents)}</p>{item.contactName && <p className="break-words text-xs text-muted-foreground">{item.contactName}</p>}</article>) : <p className="text-sm text-muted-foreground">Nenhuma oportunidade nesta etapa.</p>}</section>
      })}</div>
      <nav className="flex flex-wrap gap-4" aria-label="Oportunidades encerradas">{(["won", "lost"] as const).map(stage => <Button key={stage} variant="outline" onClick={() => setQuery({ ...query, stage, offset: 0 })}>{pipelineStages[stage]} · {result.value?.totals.find(t => t.stage === stage)?.count || 0}</Button>)}<Button variant="outline" onClick={() => setQuery({ ...query, stage: "", offset: 0 })}>Em andamento</Button></nav>
      <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Paginação do funil"><span>{result.value?.total || 0} oportunidade(s) no filtro</span><div className="flex gap-2"><Button variant="outline" disabled={query.offset === 0} onClick={() => setQuery({ ...query, offset: Math.max(0, query.offset - 100) })}>Anterior</Button><Button variant="outline" disabled={query.offset + 100 >= (result.value?.total || 0)} onClick={() => setQuery({ ...query, offset: query.offset + 100 })}>Próxima</Button></div></nav>
    </>}
  </main>
}

export function OpportunityEditor({ id }: { id?: string }) {
  const result = useResource<{ tenantId: string; canEdit: boolean; data: Opportunity | Opportunity[] }>(id ? `/api/erp/opportunities/${id}` : "/api/erp/opportunities?limit=1")
  return <main className="mx-auto max-w-4xl space-y-5 px-4 pb-24 pt-6"><PageHeader eyebrow="Vendas / Funil" title={id ? "Oportunidade comercial" : "Nova oportunidade"} description="Mantenha empresa, contato e contexto comercial até a criação do pedido." /><Link className="text-primary underline" href="/vendas/funil">Voltar ao funil</Link>{result.loading ? <p role="status">Carregando oportunidade e permissões…</p> : result.error ? <p role="alert"><RequestError message={result.error} status={result.status} /></p> : result.value && <OpportunityForm key={`${result.value.tenantId}:${result.etag}`} tenant={result.value.tenantId} canEdit={result.value.canEdit} initial={id && !Array.isArray(result.value.data) ? result.value.data : undefined} etag={result.etag} onSaved={result.reload} />}</main>
}
function OpportunityForm({ initial, etag, tenant, canEdit, onSaved }: { initial?: Opportunity; etag: string; tenant: string; canEdit: boolean; onSaved: () => void }) {
  const router = useRouter()
  const command = useCommand()
  const [draft, setDraft] = useState(() => ({ title: initial?.title || "", estimated: initial ? inputAmount(initial.estimatedCents) : "0,00", stage: initial?.stage || "new", companyName: initial?.companyName || "", companyTaxId: initial?.companyTaxId || "", contactName: initial?.contactName || "", phone: initial?.phone || "", email: initial?.email || "", source: initial?.source || "", notes: initial?.notes || "" }))
  const [customer, setCustomer] = useState<Choice | null>(initial?.customerId ? { id: initial.customerId, legalName: initial.customerName || "Cliente selecionado" } : null)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState("")
  const disabled = !canEdit || command.busy || command.uncertain || command.stale
  useNavigationGuard(dirty || command.uncertain ? "Sair sem confirmar esta oportunidade?" : null)
  function change(patch: Partial<typeof draft>) { setDraft({ ...draft, ...patch }); setDirty(true) }
  async function save() {
    setError("")
    const estimatedCents = parseAmount(draft.estimated)
    if (estimatedCents === null) { setError("Informe um valor estimado válido."); return }
    const body = { title: draft.title, stage: draft.stage, companyName: draft.companyName, companyTaxId: draft.companyTaxId, contactName: draft.contactName, phone: draft.phone, email: draft.email, source: draft.source, notes: draft.notes, estimatedCents, customerId: customer?.id || null }
    const saved = await command.send<Snapshot>(initial ? `/api/erp/opportunities/${initial.id}` : "/api/erp/opportunities", tenant, body, initial ? etag : "", initial ? "PUT" : "POST")
    if (saved?.tenantId === tenant) { setDirty(false); if (initial) onSaved(); else router.replace(`/vendas/funil/${saved.data.id}`) }
  }
  return <div className="space-y-5">{initial?.orderId && <Link className="text-primary underline" href={`/vendas/pedidos/${initial.orderId}`}>Abrir pedido vinculado</Link>}{initial && !initial.orderId && <Link className="inline-flex min-h-10 items-center rounded-lg border px-4 text-primary" href={`/vendas/simulador?oportunidade=${initial.id}`}>Avançar para simulação e pedido</Link>}
    <form className="form-section space-y-5" onSubmit={event => { event.preventDefault(); void save() }}><fieldset disabled={disabled} className="min-w-0 space-y-4">
      <label className="grid gap-2">CNPJ da empresa (opcional)<Input maxLength={18} value={draft.companyTaxId} onChange={e => change({ companyTaxId: e.target.value })} /></label>
      <RegistryLookup kind="cnpj" context="party" tenantId={tenant} readValue={() => draft.companyTaxId} disabled={disabled} onApply={fields => { if (draft.companyName || !fields.legalName) return 0; change({ companyName: fields.legalName }); return 1 }} />
      <div className="grid gap-4 sm:grid-cols-2">{([["title", "O que está sendo vendido", 200], ["estimated", "Valor estimado (R$)", 16], ["companyName", "Empresa, se ainda não é cliente", 200], ["contactName", "Pessoa de contato", 200], ["phone", "Telefone ou WhatsApp", 40], ["email", "E-mail", 254], ["source", "De onde veio", 200]] as const).map(([key, label, max]) => <label key={key} className="grid gap-2">{label}<Input required={key === "title" || key === "companyName" && !customer} type={key === "email" ? "email" : "text"} inputMode={key === "estimated" ? "decimal" : "text"} maxLength={max} value={draft[key]} onChange={e => change({ [key]: e.target.value })} /></label>)}</div>
      <Lookup endpoint="parties" label="cliente" disabled={disabled || Boolean(initial?.orderId)} choose={value => { setCustomer(value); setDirty(true) }} /><p>Cliente do cadastro: {customer?.legalName || "Ainda não é cliente"}</p>{customer && !initial?.orderId && <Button variant="outline" type="button" onClick={() => { setCustomer(null); setDirty(true) }}>Usar empresa sem cadastro definitivo</Button>}
      <label className="grid gap-2">Etapa<select className="min-h-10 rounded-lg border bg-background px-3" value={draft.stage} onChange={e => change({ stage: e.target.value as Stage })}>{Object.entries(pipelineStages).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="grid gap-2">Observações<textarea className="min-h-24 rounded-lg border bg-background p-3" maxLength={5000} value={draft.notes} onChange={e => change({ notes: e.target.value })} /></label>
    </fieldset>{(error || command.error) && <p role="alert"><RequestError message={error || command.error} status={command.status || undefined} /></p>}<Button type="submit" disabled={!canEdit || command.busy || command.stale || !dirty}>{command.uncertain ? "Conferir gravação com o mesmo comando" : initial ? "Salvar oportunidade" : "Criar oportunidade"}</Button>{command.stale && <p>Outra pessoa alterou a oportunidade. Sua edição foi preservada; confira o registro antes de continuar.</p>}</form>
  </div>
}
