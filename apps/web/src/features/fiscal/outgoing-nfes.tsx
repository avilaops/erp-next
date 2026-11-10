"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/workspace/data-table"
import { PageTitle } from "@/components/workspace/page-title"
import { erpFetch } from "@/lib/api/client"
import type { FiscalReadiness } from "./nfe-draft-model"
import { filterNotes, mergeNotes, noteStatus, type ListedDraft, type ListedEmission, type Note } from "./outgoing-nfe-model"

type State = { tenantId: string; notes: Note[]; readiness: FiscalReadiness; certificateStatus?: string; permissions: string[] }
const selectClass = "block h-9 w-full rounded-lg border bg-background px-3 text-sm"
const cell = "px-4 py-3 text-left align-top"

export function OutgoingNfes() {
  const [state, setState] = useState<State | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const [filters, setFilters] = useState({ query: "", status: "", environment: "", from: "", to: "" })

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

  const rows = filterNotes(state?.notes || [], filters)
  const readiness = state?.readiness
  const invalidPeriod = !!filters.from && !!filters.to && filters.from > filters.to
  return <main className="mx-auto w-full min-w-0 max-w-7xl space-y-4 px-4 pb-24 pt-6 lg:px-6">
    <section className="form-section min-w-0 space-y-4" aria-label="Notas fiscais de saída">
      <div className="flex flex-wrap items-center justify-between gap-3"><PageTitle className="text-lg font-semibold">Notas fiscais de saída</PageTitle><div className="flex flex-wrap gap-2">{readiness && <span className="rounded-full border px-3 py-2 text-xs font-medium">Ambiente: {readiness.profileConfigured ? readiness.environment === "production" ? "Produção" : "Homologação · sem valor fiscal" : "Não configurado"}</span>}{state?.permissions.includes("fiscal.nfe.manage") && <><Link className={buttonVariants({ variant: "outline" })} href="/fiscal/notas-saida/importar">Importar XML</Link><Link className={buttonVariants()} href="/fiscal/notas-saida/nova">Preparar nota</Link></>}</div></div>
      <div role="search" aria-label="Filtrar notas fiscais" className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
        <label className="grid gap-2 text-sm">Buscar nota<Input value={filters.query} onChange={e => setFilters({ ...filters, query: e.target.value })} placeholder="Cliente, CPF/CNPJ, número ou chave" /></label>
        <label className="grid gap-2 text-sm">Situação<select aria-label="Situação" className={selectClass} value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}><option value="">Todas</option>{Object.entries(noteStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="grid gap-2 text-sm">Ambiente<select aria-label="Ambiente" className={selectClass} value={filters.environment} onChange={e => setFilters({ ...filters, environment: e.target.value })}><option value="">Todos</option><option value="production">Produção</option><option value="homologation">Homologação</option></select></label>
        <label className="grid gap-2 text-sm">De<Input type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} /></label>
        <label className="grid gap-2 text-sm">Até<Input type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} /></label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-sm text-muted-foreground">{busy ? "Carregando notas fiscais…" : state ? `${rows.length} nota(s)` : "Consulta indisponível"}</p><div className="flex gap-2"><Button variant="ghost" onClick={() => setFilters({ query: "", status: "", environment: "", from: "", to: "" })}>Limpar filtros</Button><Button variant="outline" disabled={busy} onClick={() => setReload(v => v + 1)}>Atualizar lista</Button></div></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {invalidPeriod && <p role="alert" className="text-sm text-destructive">A data inicial deve ser anterior ou igual à final.</p>}
      {state && !invalidPeriod && (rows.length ? <div className="workspace-list-scroll" role="region" aria-label="Lista de notas fiscais de saída" tabIndex={0}><DataTable className="w-full min-w-[900px] text-sm"><caption className="sr-only">Notas fiscais de saída da empresa ativa</caption><thead className="bg-muted/50"><tr>{["Número / série", "Destinatário", "Data", "Valor dos produtos", "Situação", "Ações"].map(label => <th className={cell} key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(note => {
        const href = `/fiscal/notas-saida/${note.id}`
        const action = note.status === "draft" ? state.permissions.includes("fiscal.nfe.manage") ? "Editar rascunho" : "Consultar rascunho" : note.status === "rejected" ? "Conferir rejeição" : ["unknown", "preparing", "prepared"].includes(note.status) ? "Conferir situação" : "Ver nota e documentos"
        return <tr className="border-t" key={note.id}><td className={cell}><Link className="font-medium text-primary underline" href={href}>{note.number ? `${note.model === 65 ? "NFC-e" : "NF-e"} ${note.number} / ${note.series}` : "Sem número"}</Link><p className="mt-1 text-xs text-muted-foreground">{note.environment === "production" ? "Produção" : "Homologação"}</p></td><td className={cell}><p>{note.recipient}</p><p className="mt-1 text-xs text-muted-foreground">{note.taxId}</p></td><td className={cell}>{note.date ? new Date(note.date).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "Não informada"}</td><td className={`${cell} whitespace-nowrap`}>{note.amount ? Number(note.amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "Nos detalhes"}</td><td className={cell}><span className={`inline-flex rounded-full px-2 py-1 text-xs ${note.status === "authorized" ? "bg-emerald-100 text-emerald-950" : ["rejected", "unknown"].includes(note.status) ? "bg-amber-100 text-amber-950" : "bg-muted"}`}>{noteStatus[note.status] || note.status}</span>{note.reason && <p className="mt-2 max-w-64 text-xs text-muted-foreground">{note.reason}</p>}</td><td className={cell}><Link className="text-primary underline" href={`${href}${note.status === "draft" ? "" : "#fiscal-emission"}`}>{action}</Link>{note.status === "authorized" && <p className="mt-2 text-xs text-muted-foreground">XML, DANFE{state.permissions.includes("fiscal.nfe.cancel") ? ", cancelamento" : ""}{state.permissions.includes("fiscal.nfe.correction") && note.model === 55 ? " e carta de correção" : ""}</p>}</td></tr>
      })}</tbody></DataTable></div> : <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{state.notes.length ? "Nenhuma nota corresponde aos filtros." : "Nenhuma nota fiscal cadastrada nesta empresa."}</p>)}
      <p className="text-xs text-muted-foreground">Rascunhos ainda não são notas autorizadas. O período considera a data de preparação para rascunhos e de emissão para os demais documentos.</p>
    </section>
  </main>
}
