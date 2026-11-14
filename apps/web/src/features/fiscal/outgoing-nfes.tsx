"use client"

import Link from "next/link"
import { Suspense, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SearchInput } from "@/components/search-input"
import { DataTable } from "@/components/workspace/data-table"
import { CurrencyCell, EmptyState, EntityListPage, FilterField, ResponsiveTable, SearchToolbar, SortableTableHeader, StatusBadge } from "@/components/workspace/list-layout"
import { useTableSort } from "@/components/workspace/use-table-sort"
import { sortTableRows, type TableSort } from "@/components/workspace/table-sort-model"
import { erpFetch } from "@/lib/api/client"
import type { FiscalReadiness } from "./nfe-draft-model"
import { filterNotes, mergeNotes, noteStatus, type ListedDraft, type ListedEmission, type Note } from "./outgoing-nfe-model"

type State = { tenantId: string; notes: Note[]; readiness: FiscalReadiness; certificateStatus?: string; permissions: string[] }
const selectClass = "block h-9 w-full rounded-lg border bg-background px-3 text-sm"
const cell = "px-4 py-3 text-left align-top"

export function sortOutgoingNotes(rows: Note[], sort: TableSort) {
  if (!sort.explicit) return rows
  return sortTableRows(rows, sort, {
    number: note => note.number ?? null,
    recipient: note => note.recipient,
    date: note => note.date ? new Date(note.date) : null,
    amount: note => note.amount ? Number(note.amount) : null,
    status: note => noteStatus[note.status] || note.status,
  }, note => note.id)
}

export function OutgoingNfes() {
  return <Suspense fallback={<p role="status">Carregando notas fiscais…</p>}><OutgoingNfeList /></Suspense>
}

function OutgoingNfeList() {
  const params = useSearchParams()
  const router = useRouter()
  const table = useTableSort(["number", "recipient", "date", "amount", "status"], { by: "date", order: "desc" })
  const [state, setState] = useState<State | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const filters = { query: params.get("q") || "", status: params.get("status") || "", environment: params.get("environment") || "", from: params.get("from") || "", to: params.get("to") || "" }
  function updateFilters(values: Record<string, string>, replace = false) {
    const next = new URLSearchParams(window.location.search)
    for (const [key, value] of Object.entries(values)) { if (value) next.set(key, value); else next.delete(key) }
    router[replace ? "replace" : "push"](`${window.location.pathname}${next.size ? `?${next}` : ""}${window.location.hash}`, { scroll: false })
  }

  useEffect(() => {
    const controller = new AbortController()
    async function json(path: string, optional = false) {
      const response = await erpFetch(path, { cache: "no-store", signal: controller.signal })
      if (optional && !response.ok) return null
      const body = await response.json()
      if (!response.ok) throw new Error(body.title || "Não foi possível consultar o fiscal")
      return body
    }
    async function pages<T>(path: string, tenant: string): Promise<T[]> {
      const result: T[] = []
      const seen = new Set<string>()
      let cursor: string | null = null
      do {
        const page = await json(`${path}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)
        if (page.tenantId !== tenant || !Array.isArray(page.data)) throw new Error("A empresa da sessão mudou. Atualize a página.")
        result.push(...page.data)
        cursor = page.nextCursor || null
        if (cursor && seen.has(cursor)) throw new Error("A paginação fiscal não avançou. Atualize a lista.")
        if (cursor) seen.add(cursor)
      } while (cursor)
      return result
    }
    async function load() {
      setBusy(true); setError(""); setState(null)
      try {
        const me = await json("/api/erp/me")
        const tenant = me.tenant?.id
        if (!tenant) throw new Error("Selecione uma empresa para consultar as notas.")
        const [drafts, emissions, readiness, certificate] = await Promise.all([
          pages<ListedDraft>("/api/erp/fiscal/nfe", tenant),
          pages<ListedEmission>("/api/erp/fiscal/issued-nfes", tenant),
          json("/api/erp/fiscal/readiness"),
          json("/api/erp/fiscal/certificate", true),
        ])
        const current = await json("/api/erp/me")
        if (current.tenant?.id !== tenant || readiness.tenantId !== tenant || certificate && certificate.tenantId !== tenant) throw new Error("A empresa da sessão mudou. Atualize a página.")
        if (!controller.signal.aborted) setState({ tenantId: tenant, notes: mergeNotes(drafts, emissions), readiness, certificateStatus: certificate?.status, permissions: current.permissions || [] })
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Não foi possível consultar o fiscal")
      } finally { if (!controller.signal.aborted) setBusy(false) }
    }
    void load()
    return () => controller.abort()
  }, [reload])

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setReload(v => v + 1) }
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh) }
  }, [])

  // Both cursor streams have been exhausted before filtering and sorting this collection.
  const notes = state?.notes
  const { query, status, environment, from, to } = filters
  const rows = useMemo(() => sortOutgoingNotes(filterNotes(notes || [], { query, status, environment, from, to }), table.sort), [notes, query, status, environment, from, to, table.sort])
  const readiness = state?.readiness
  const invalidPeriod = !!filters.from && !!filters.to && filters.from > filters.to
  return <main className="mx-auto w-full min-w-0 max-w-7xl space-y-4 px-4 pb-24 pt-6 lg:px-6">
    <EntityListPage title="Notas fiscais de saída" actions={<div className="flex flex-wrap gap-2">{readiness && <StatusBadge tone="info">Ambiente: {readiness.profileConfigured ? readiness.environment === "production" ? "Produção" : "Homologação · sem valor fiscal" : "Não configurado"}</StatusBadge>}{state?.permissions.includes("fiscal.nfe.manage") && <><Link className={buttonVariants({ variant: "outline" })} href="/fiscal/notas-saida/importar">Importar XML</Link><Link className={buttonVariants()} href="/fiscal/notas-saida/nova">Preparar nota</Link></>}</div>}
      toolbar={<SearchToolbar pending={busy} canClear={Object.values(filters).some(Boolean)} onClear={() => updateFilters({ q: "", status: "", environment: "", from: "", to: "" })} onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); updateFilters(Object.fromEntries(["q", "status", "environment", "from", "to"].map(key => [key, String(data.get(key) || "").trim()]))) }}>
        <FilterField label="Buscar nota"><SearchInput name="q" defaultValue={filters.query} onSearch={value => updateFilters({ q: value }, true)} placeholder="Cliente, CPF/CNPJ, número ou chave" /></FilterField>
        <FilterField label="Situação"><select name="status" className={selectClass} value={filters.status} onChange={event => updateFilters({ status: event.target.value })}><option value="">Todas</option>{Object.entries(noteStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FilterField>
        <FilterField label="Ambiente"><select name="environment" className={selectClass} value={filters.environment} onChange={event => updateFilters({ environment: event.target.value })}><option value="">Todos</option><option value="production">Produção</option><option value="homologation">Homologação</option></select></FilterField>
        <FilterField label="De"><Input name="from" type="date" value={filters.from} onChange={event => updateFilters({ from: event.target.value })} /></FilterField>
        <FilterField label="Até"><Input name="to" type="date" value={filters.to} onChange={event => updateFilters({ to: event.target.value })} /></FilterField>
      </SearchToolbar>}
      summary={<div className="flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-sm text-muted-foreground">{busy ? "Carregando notas fiscais…" : state ? `${rows.length} nota(s)` : "Consulta indisponível"}</p><Button variant="outline" disabled={busy} onClick={() => setReload(v => v + 1)}>Atualizar lista</Button></div>}
      footer={<p className="text-xs text-muted-foreground">Rascunhos ainda não são notas autorizadas. O período considera a data de preparação para rascunhos e de emissão para os demais documentos.</p>}>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {invalidPeriod && <p role="alert" className="text-sm text-destructive">A data inicial deve ser anterior ou igual à final.</p>}
      {state && !invalidPeriod && <ResponsiveTable label="Lista de notas fiscais de saída"><DataTable className="w-full min-w-[900px] text-sm"><caption className="sr-only">Notas fiscais de saída da empresa ativa</caption><thead className="bg-muted/50"><tr>{[["number", "Número / série"], ["recipient", "Destinatário"], ["date", "Data"], ["amount", "Valor dos produtos"], ["status", "Situação"]].map(([field, label]) => <SortableTableHeader className={cell} field={field} sort={table.sort} onSort={table.toggle} key={field}>{label}</SortableTableHeader>)}<th scope="col" className={cell}>Ações</th></tr></thead><tbody>{rows.map(note => {
        const href = `/fiscal/notas-saida/${note.id}`
        const action = note.status === "draft" ? state.permissions.includes("fiscal.nfe.manage") ? "Editar rascunho" : "Consultar rascunho" : note.status === "rejected" ? "Conferir rejeição" : ["unknown", "preparing", "prepared"].includes(note.status) ? "Conferir situação" : "Ver nota e documentos"
        return <tr className="border-t" key={note.id}><td className={cell}><Link className="font-medium text-primary underline" href={href}>{note.number ? `${note.model === 65 ? "NFC-e" : "NF-e"} ${note.number} / ${note.series}` : "Sem número"}</Link><p className="mt-1 text-xs text-muted-foreground">{note.environment === "production" ? "Produção" : "Homologação"}</p></td><td className={cell}><p>{note.recipient}</p><p className="mt-1 text-xs text-muted-foreground">{note.taxId}</p></td><td className={cell}>{note.date ? new Date(note.date).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "Não informada"}</td><CurrencyCell className={cell}>{note.amount ? Number(note.amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "Nos detalhes"}</CurrencyCell><td className={cell}><StatusBadge tone={note.status === "authorized" ? "success" : ["rejected", "unknown"].includes(note.status) ? "warning" : "neutral"}>{noteStatus[note.status] || note.status}</StatusBadge>{note.reason && <p className="mt-2 max-w-64 text-xs text-muted-foreground">{note.reason}</p>}</td><td className={cell}><Link className="text-primary underline" href={`${href}${note.status === "draft" ? "" : "#fiscal-emission"}`}>{action}</Link>{note.status === "authorized" && <p className="mt-2 text-xs text-muted-foreground">XML, DANFE{state.permissions.includes("fiscal.nfe.cancel") ? ", cancelamento" : ""}{state.permissions.includes("fiscal.nfe.correction") && note.model === 55 ? " e carta de correção" : ""}</p>}</td></tr>
      })}{!rows.length && <tr><td colSpan={6}><EmptyState filtered={Object.values(filters).some(Boolean)} description={state.notes.length ? "Nenhuma nota corresponde aos filtros." : "Nenhuma nota fiscal cadastrada nesta empresa."} action={!Object.values(filters).some(Boolean) && state.permissions.includes("fiscal.nfe.manage") ? <Link className={buttonVariants()} href="/fiscal/notas-saida/nova">Preparar nota</Link> : undefined} /></td></tr>}</tbody></DataTable></ResponsiveTable>}
    </EntityListPage>
  </main>
}
