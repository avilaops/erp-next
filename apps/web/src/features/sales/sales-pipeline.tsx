"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { EntityListPage, SearchToolbar, FilterField, StatusBadge, EmptyState, ResponsiveTable, CurrencyCell, SortableTableHeader } from "@/components/workspace/list-layout"
import { useTableSort } from "@/components/workspace/use-table-sort"

import { GuardedLink as Link } from "@/components/shell/navigation-guard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/workspace/data-table"
import { Pagination } from "@/components/workspace/pagination"
import { RequestError } from "@/components/feedback/session-recovery"
import { useResource } from "@/hooks/use-operation"
import type { Opportunity } from "./opportunities"
import { pipelineMoney as money, pipelineHref, pipelinePageSize, pipelineStages, pipelineSummary, readPipelineQuery, type PipelineQuery, type PipelineTotal } from "./opportunity-pipeline-model"

type Listing = { tenantId: string; canEdit: boolean; data: Opportunity[]; total: number; totals: PipelineTotal[] }

export function SalesPipeline() {
  return <Suspense fallback={<main className="p-4"><p role="status">Carregando oportunidades…</p></main>}><PipelineRoute /></Suspense>
}

function PipelineRoute() {
  const params = useSearchParams()
  const query = readPipelineQuery(params)
  return <PipelineResults key={pipelineHref(query)} query={query} />
}

function PipelineResults({ query }: { query: PipelineQuery }) {
  const router = useRouter()
  const { sort, toggle, query: sortQuery } = useTableSort(["title", "companyName", "stage", "estimatedCents"], { by: "", order: "asc" })
  const [search, setSearch] = useState(query.q)
  const params = new URLSearchParams({ q: query.q, stage: query.stage, offset: String(query.offset), limit: String(pipelinePageSize) })
  for (const [key, value] of sortQuery) params.set(key, value)
  const result = useResource<Listing>(`/api/erp/opportunities?${params}`)
  const summary = pipelineSummary(result.value?.totals)
  const filtered = Boolean(query.q || query.stage)
  const emptyPage = query.offset > 0 && result.value?.data.length === 0
  function navigate(next: PipelineQuery) {
    const normalized = readPipelineQuery(new URLSearchParams({ q: next.q, stage: next.stage, offset: String(next.offset) }))
    const current = new URLSearchParams(window.location.search)
    for (const [key, value] of Object.entries(normalized)) { if (value) current.set(key, String(value)); else current.delete(key) }
    const search = current.toString()
    const href = window.location.pathname + (search ? `?${search}` : "") + window.location.hash
    if (normalized.q === query.q && normalized.stage === query.stage && normalized.offset === query.offset) result.reload()
    else router.push(href, { scroll: false })
  }
  return <main className="mx-auto min-w-0 max-w-7xl space-y-3 px-4 pb-6 pt-4 [--workspace-control-height:44px] sm:[--workspace-control-height:36px]">
    <EntityListPage title="Funil comercial" actions={!result.loading && result.value?.canEdit && <Link className="inline-flex min-h-11 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground" href="/vendas/funil/nova">Nova oportunidade</Link>} toolbar={
      <SearchToolbar pending={result.loading} canClear={filtered || Boolean(search)} onClear={() => { setSearch(""); navigate({ q: "", stage: "", offset: 0 }) }} onSubmit={event => { event.preventDefault(); navigate({ ...query, q: search, offset: 0 }) }}>
        <FilterField label="Buscar oportunidade, empresa ou contato"><Input type="search" maxLength={160} value={search} onChange={event => setSearch(event.target.value)} /></FilterField>
        <FilterField label="Etapa"><select className="min-h-9 min-w-0 rounded-lg border bg-background px-2" value={query.stage} onChange={event => navigate({ q: search, stage: event.target.value as PipelineQuery["stage"], offset: 0 })}><option value="">Todas as etapas</option>{Object.entries(pipelineStages).map(([stage, label]) => <option value={stage} key={stage}>{label}</option>)}</select></FilterField>
      </SearchToolbar>
    } summary={!result.loading && !result.error && result.value && (summary ? <details className="rounded-lg border bg-background p-3">
      <summary className="min-h-11 cursor-pointer text-sm focus-visible:outline-2 focus-visible:outline-ring"><span className="font-medium">Resumo da empresa</span><span className="mt-1 block pl-4 text-xs text-muted-foreground">{summary.open.count} em andamento · {money(summary.open.estimatedCents)}</span></summary>
      <p className="mt-2 text-xs text-muted-foreground">Valores de todas as oportunidades da empresa, antes dos filtros.</p>
      <dl className="mt-3 grid gap-3 sm:grid-cols-3">{([["Em andamento", summary.open], ["Ganho", summary.won], ["Perdido", summary.lost]] as const).map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-sm font-medium">{value.count} · {money(value.estimatedCents)}</dd></div>)}</dl>
    </details> : <p className="text-sm text-muted-foreground">Resumo da empresa indisponível.</p>)}>
    {result.loading ? <p role="status">Carregando oportunidades…</p> : result.error || !result.value ? <div className="space-y-2 rounded-lg border bg-background p-3"><p role="alert"><RequestError message={result.error || "Lista de oportunidades indisponível."} status={result.status} /></p><Button type="button" variant="outline" onClick={result.reload}>Tentar novamente</Button></div> : <>
      <p role="status" className="text-xs text-muted-foreground">{result.value.total} oportunidade(s) no filtro · {result.value.data.length} nesta página</p>
      <ResponsiveTable label="Oportunidades do funil"><DataTable className="min-w-[48rem] text-sm">
        <caption className="sr-only">Oportunidades do funil</caption>
        <thead className="bg-muted/50 text-xs"><tr><SortableTableHeader field="title" sort={sort} onSort={toggle} className="w-[62%] p-2 text-left sm:w-auto">Oportunidade</SortableTableHeader><SortableTableHeader field="companyName" sort={sort} onSort={toggle} className="p-2 text-left">Empresa</SortableTableHeader><SortableTableHeader field="stage" sort={sort} onSort={toggle} className="p-2 text-left">Etapa</SortableTableHeader><SortableTableHeader field="estimatedCents" sort={sort} onSort={toggle} className="w-[38%] p-2 text-right sm:w-auto">Valor estimado</SortableTableHeader></tr></thead>
        <tbody>{result.value.data.map(item => <tr className="border-t hover:bg-muted/20" key={item.id}>
          <td className="min-w-0 p-2 align-top"><Link className="flex min-h-11 items-center break-words font-medium text-primary underline underline-offset-2 [overflow-wrap:anywhere] sm:min-h-0" title={item.title} href={`/vendas/funil/${item.id}`}>{item.title}</Link>{item.contactName && <p className="mt-1 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{item.contactName}</p>}</td>
          <td className="break-words p-2 align-top [overflow-wrap:anywhere]">{item.customerName || item.companyName || "Empresa não informada"}</td>
          <td className="break-words p-2 align-top"><StatusBadge tone={item.stage === "won" ? "success" : item.stage === "lost" ? "danger" : "info"}>{pipelineStages[item.stage] || "Etapa não informada"}</StatusBadge></td>
          <CurrencyCell className="p-2 align-top font-medium">{Number.isSafeInteger(item.estimatedCents) && item.estimatedCents >= 0 ? money(item.estimatedCents) : "Valor indisponível"}</CurrencyCell>
        </tr>)}{!result.value.data.length && <tr><td colSpan={4}><EmptyState filtered={filtered} title={emptyPage ? "Nenhuma oportunidade nesta página." : undefined} description={emptyPage ? "Volte à primeira página para consultar as oportunidades." : undefined} action={emptyPage ? <Button type="button" variant="outline" onClick={() => navigate({ ...query, offset: 0 })}>Voltar à primeira página</Button> : result.value.canEdit ? <Link href="/vendas/funil/nova">Nova oportunidade</Link> : undefined} /></td></tr>}</tbody>
      </DataTable></ResponsiveTable>
      {!emptyPage && <Pagination offset={query.offset} pageSize={pipelinePageSize} total={result.value.total} maxOffset={100000} onOffsetChange={offset => navigate({ ...query, offset })} />}
    </>}
    </EntityListPage>
  </main>
}
