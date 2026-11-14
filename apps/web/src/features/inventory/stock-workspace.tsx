"use client"

import { Pagination } from "@/components/workspace/pagination"
import { erpFetch } from "@/lib/api/client"

import type { Schema } from "@/lib/api/types"

import { GuardedLink as Link } from "@/components/shell/navigation-guard"
import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { SearchInput } from "@/components/search-input"
import { Input } from "@/components/ui/input"
import { EntityListPage, SearchToolbar, FilterField, StatusBadge, EmptyState, ResponsiveTable, SortableTableHeader } from "@/components/workspace/list-layout"
import { useTableSort } from "@/components/workspace/use-table-sort"
import { DataTable } from "@/components/workspace/data-table"
import { decimalPattern, normalizeDecimal } from "@/lib/decimal-input"
import { commercialQuantity } from "@/features/sales/order-presentation"

type Stock = Schema<"Stock">
type Movement = Schema<"Movement">
type StockList = Schema<"StockList">
type History = Schema<"MovementList">
type Draft = { direction: "receipt" | "issue"; quantity: string; reason: string }
const blank: Draft = { direction: "receipt", quantity: "", reason: "" }
const selectClass = "block h-9 w-full min-w-0 rounded-lg border bg-background px-3 text-sm"

export function StockWorkspace() {
  const router = useRouter()
  const url = useSearchParams()
  const offsetValue = Number(url.get("offset") || 0)
  const offset = Number.isSafeInteger(offsetValue) && offsetValue >= 0 && offsetValue <= 100000 ? Math.floor(offsetValue / 25) * 25 : 0
  const { sort, toggle, query: sortQuery } = useTableSort(["name", "quantity", "reserved", "available"], { by: "", order: "asc" })
  function navigate(patch: Record<string, string | number>) {
    const next = new URLSearchParams(window.location.search)
    for (const [key, value] of Object.entries(patch)) { if (String(value)) next.set(key, String(value)); else next.delete(key) }
    router.push(`${window.location.pathname}?${next}${window.location.hash}`, { scroll: false })
  }
  const q = (url.get("q") || "").slice(0, 160)
  const query = { q, offset }
  const stockParams = new URLSearchParams({ q, offset: String(offset), limit: "25" })
  for (const [key, value] of sortQuery) stockParams.set(key, value)
  const stockRequest = `/api/erp/stock?${stockParams}`
  const [loadedRequest, setLoadedRequest] = useState("")
  const [search, setSearch] = useState(q)

  const [stocks, setStocks] = useState<StockList | null>(null)
  const [loading, setLoading] = useState(true)
  const listPending = loading || loadedRequest !== stockRequest
  const [listError, setListError] = useState("")
  const [selected, setSelected] = useState<Stock | null>(null)
  const [history, setHistory] = useState<History | null>(null)
  const [historyOffset, setHistoryOffset] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState("")
  const [draft, setDraft] = useState<Draft>({ ...blank })
  const [reversal, setReversal] = useState<Movement | null>(null)
  const [saving, setSaving] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [writeError, setWriteError] = useState("")
  const [notice, setNotice] = useState("")
  const [refresh, setRefresh] = useState(0)
  const pending = useRef(false)
  const command = useRef<{ key: string; body: string } | null>(null)
  const dirty = Boolean(draft.quantity || draft.reason || reversal)

  useEffect(() => {
    const controller = new AbortController()
    erpFetch(stockRequest, { cache: "no-store", signal: controller.signal }).then(async response => {
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Estoque indisponível")
      if (!controller.signal.aborted) { setStocks(value); setListError("") }
    }).catch(error => { if (!controller.signal.aborted) { setStocks(null); setListError(error.message) } })
      .finally(() => { if (!controller.signal.aborted) { setLoading(false); setLoadedRequest(stockRequest) } })
    return () => controller.abort()
  }, [stockRequest, refresh])

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    const params = new URLSearchParams({ productId: selected.productId, offset: String(historyOffset), limit: "25" })
    erpFetch(`/api/erp/stock/movements?${params}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Histórico indisponível")
      if (!controller.signal.aborted) { setHistory(value); setHistoryError("") }
    }).catch(error => { if (!controller.signal.aborted) { setHistory(null); setHistoryError(error.message) } })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false) })
    return () => controller.abort()
  }, [selected, historyOffset, refresh])

  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty || uncertain) event.preventDefault() }
    window.addEventListener("beforeunload", prevent)
    return () => window.removeEventListener("beforeunload", prevent)
  }, [dirty, uncertain])

  function choose(stock: Stock) {
    if (pending.current || uncertain) return
    if (dirty && !window.confirm("Descartar o lançamento ainda não confirmado?")) return
    setSelected(stock); setHistory(null); setHistoryOffset(0); setHistoryLoading(true)
    setDraft({ ...blank }); setReversal(null); setWriteError(""); setNotice(""); command.current = null
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!selected || !stocks?.canEdit || !history?.canEdit || pending.current) return
    const normalizedQuantity = normalizeDecimal(draft.quantity, 6)
    if (!uncertain && normalizedQuantity === null) {
      setWriteError("Informe quantidade decimal positiva com até seis casas e sem zeros à esquerda")
      return
    }
    pending.current = true; setSaving(true); setWriteError(""); setNotice("")
    if (!uncertain) command.current = {
      key: crypto.randomUUID(),
      body: JSON.stringify({ productId: selected.productId, ...draft, quantity: normalizedQuantity, reversesId: reversal?.id || null }),
    }
    try {
      const response = await erpFetch("/api/erp/stock/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tenant-Id": stocks.tenantId, "Idempotency-Key": command.current!.key },
        body: command.current!.body,
      })
      const value = await response.json()
      if (!response.ok) {
        setUncertain(response.status >= 500)
        throw new Error(value.title || "Lançamento recusado")
      }
      setUncertain(false); command.current = null; setDraft({ ...blank }); setReversal(null)
      setNotice(`Movimento confirmado. Saldo após o lançamento: ${commercialQuantity(value.balanceAfter)} ${selected.unit}.`)
      setSelected({ ...selected, quantity: value.balanceAfter }); setHistoryOffset(0)
      setHistoryLoading(true); setLoading(true); setRefresh(value => value + 1)
    } catch (error) {
      // A lost response can follow a committed transaction: preserve the exact command for retry.
      if (error instanceof TypeError || error instanceof SyntaxError) setUncertain(true)
      setWriteError(error instanceof Error ? error.message : "Não foi possível confirmar o lançamento")
    } finally { pending.current = false; setSaving(false) }
  }

  return <div className="workspace-page-frame">

    <EntityListPage title="Saldos por produto" actions={<><Link className="text-primary underline" href="/cadastros/produtos">Consultar catálogo</Link>{stocks?.canEdit && <Link className="text-primary underline" href="/cadastros/produtos/novo" target="_blank" rel="noopener noreferrer">Cadastrar produto</Link>}</>} toolbar={
      <SearchToolbar pending={listPending} canClear={Boolean(q || search)} onClear={() => { setSearch(""); navigate({ q: "", offset: 0 }) }} onSubmit={event => { event.preventDefault(); const nextQ = String(new FormData(event.currentTarget).get("q") || ""); if (nextQ === q && !offset) { setLoading(true); setRefresh(value => value + 1) } else navigate({ q: nextQ, offset: 0 }) }}>
        <FilterField label="Buscar produto ou SKU"><SearchInput name="q" maxLength={160} defaultValue={q} onChange={event => setSearch(event.target.value)} onSearch={q => navigate({ q, offset: 0 })} /></FilterField>
      </SearchToolbar>
    } summary={!listPending && !listError && (<p className="text-sm text-muted-foreground">{stocks?.total} produto(s) · {stocks?.canEdit ? "Consulta e movimentação" : "Somente consulta"}</p>)} footer={!listPending && !listError && (<Pagination offset={query.offset} pageSize={25} total={stocks?.total || 0} onOffsetChange={offset => navigate({ offset })} />)}>
      {listPending ? <p role="status">Carregando saldos…</p> : listError ? <div role="alert" className="space-y-3"><p>{listError}</p><Button variant="outline" onClick={() => { setLoading(true); setRefresh(value => value + 1) }}>Tentar novamente</Button></div> : stocks && <>
        <ResponsiveTable label="Lista de saldos"><DataTable aria-label="Saldos por produto" className="min-w-[48rem] [&_td]:px-2 [&_th]:px-2 lg:[&_td]:px-4 lg:[&_th]:px-4">
          <thead><tr><SortableTableHeader field="name" sort={sort} onSort={toggle} className="w-[54%] lg:w-[46%]">Produto</SortableTableHeader><SortableTableHeader field="quantity" sort={sort} onSort={toggle} className="w-[46%] text-right lg:w-[18%]">Saldo</SortableTableHeader><SortableTableHeader field="reserved" sort={sort} onSort={toggle} className="text-right lg:w-[18%]">Reservado</SortableTableHeader><SortableTableHeader field="available" sort={sort} onSort={toggle} className="text-right lg:w-[18%]">Disponível</SortableTableHeader></tr></thead>
          <tbody>{stocks.data.map(stock => <tr key={stock.productId} className={selected?.productId === stock.productId ? "bg-primary/5" : undefined}>
            <th scope="row" className="text-left align-top"><button type="button" className="min-h-11 w-full rounded-sm text-left font-normal outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60 [overflow-wrap:anywhere]" disabled={saving || uncertain} aria-pressed={selected?.productId === stock.productId} onClick={() => choose(stock)}>
              <strong className="block font-medium">{stock.name}</strong><span className="mt-1 block text-xs text-muted-foreground">SKU {stock.sku} · <StatusBadge tone={stock.status === "active" ? "success" : "neutral"}>{stock.status === "active" ? "Ativo" : "Arquivado"}</StatusBadge></span>
              <span className="mt-1 block text-xs font-medium text-primary underline underline-offset-4">Ver movimentos</span>
            </button></th>
            <td className="text-right align-top tabular-nums [overflow-wrap:anywhere]"><span className="font-medium">{commercialQuantity(stock.quantity)} {stock.unit}</span></td>
            <td className="text-right tabular-nums">{commercialQuantity(stock.reserved)}</td><td className="text-right tabular-nums">{commercialQuantity(stock.available)}</td>
          </tr>)}{!stocks.data.length && <tr><td colSpan={4}><EmptyState filtered={Boolean(q)} action={stocks.canEdit && <Link href="/cadastros/produtos/novo">Cadastrar produto</Link>} /></td></tr>}</tbody>
        </DataTable></ResponsiveTable>
      </>}
    </EntityListPage>

    {selected && <section className="form-section mt-5 min-w-0 space-y-5" aria-label="Movimentos do produto">
      <h2 className="break-words font-semibold">Movimentos de {selected.name}</h2>
      {notice && <p role="status">{notice}</p>}
      {historyLoading ? <p role="status">Carregando movimentos…</p> : historyError ? <div role="alert"><p>{historyError}</p><Button variant="outline" onClick={() => { setHistoryLoading(true); setRefresh(value => value + 1) }}>Recarregar histórico</Button></div> : history && <>
        {!history.canEdit && <p>Somente consulta. Você não pode movimentar o estoque.</p>}
        {history.canEdit && stocks?.canEdit && <form onSubmit={save} className="space-y-4">
          <h3 className="font-medium">{reversal ? "Estornar movimento" : "Novo lançamento"}</h3>
          <fieldset disabled={saving || uncertain || selected.status !== "active"} className="grid min-w-0 gap-4 sm:grid-cols-2">
            <label className="min-w-0 space-y-2">Direção<select className={selectClass} value={draft.direction} disabled={Boolean(reversal)} onChange={event => { setDraft({ ...draft, direction: event.target.value as Draft["direction"] }); setNotice("") }}><option value="receipt">Entrada</option><option value="issue">Saída</option></select></label>
            <label className="min-w-0 space-y-2">Quantidade (vírgula ou ponto)<Input required inputMode="decimal" pattern={decimalPattern(6)} maxLength={19} value={draft.quantity} disabled={Boolean(reversal)} onChange={event => { setDraft({ ...draft, quantity: event.target.value }); setNotice("") }} /></label>
            <label className="min-w-0 space-y-2 sm:col-span-2">Motivo<Input required minLength={3} maxLength={500} value={draft.reason} onChange={event => { setDraft({ ...draft, reason: event.target.value }); setNotice("") }} /></label>
          </fieldset>
          {selected.status !== "active" && <p>Reative o produto no catálogo antes de movimentar.</p>}
          {writeError && <p role="alert">{writeError}</p>}
          {uncertain && <p role="alert">A resposta não confirmou o resultado. Repita o mesmo lançamento para consultar sua confirmação sem duplicar o movimento.</p>}
          <div className="flex flex-wrap gap-3"><Button type="submit" disabled={saving || selected.status !== "active"}>{saving ? "Confirmando…" : uncertain ? "Repetir confirmação" : reversal ? "Confirmar estorno" : "Confirmar lançamento"}</Button>{reversal && !uncertain && <Button type="button" variant="outline" disabled={saving} onClick={() => { setReversal(null); setDraft({ ...blank }); setWriteError("") }}>Cancelar estorno</Button>}</div>
        </form>}
        <h3 className="font-medium">Histórico registrado</h3>
        {history.data.length ? <ul className="divide-y border-y">{history.data.map(movement => <li key={movement.id} className="min-w-0 space-y-2 py-3">
          <p className="break-words font-medium">{movement.reversesId ? "Estorno · " : ""}{movement.direction === "receipt" ? "Entrada" : "Saída"} de {commercialQuantity(movement.quantity)} {selected.unit}</p>
          <p className="break-words text-sm">{movement.reason}</p>
          <p className="break-words text-sm text-muted-foreground">Saldo após: {commercialQuantity(movement.balanceAfter)} · Registro: {new Date(movement.occurredAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>
          <p className="break-all text-xs text-muted-foreground">ID: {movement.id}{movement.reversesId && ` · Estorna: ${movement.reversesId}`}</p>
          {movement.sourceOrderId && <p className="break-all text-sm text-muted-foreground">Pedido de origem: {movement.sourceOrderId}. Devolução ainda não disponível.</p>}
          {history.canEdit && !movement.reversesId && !movement.sourceOrderId && <Button variant="outline" disabled={saving || uncertain || selected.status !== "active" || Boolean(reversal)} onClick={() => {
            if (dirty && !window.confirm("Substituir o lançamento em edição por um estorno?")) return
            setReversal(movement); setDraft({ direction: movement.direction === "receipt" ? "issue" : "receipt", quantity: movement.quantity, reason: "" }); setWriteError(""); setNotice("")
          }}>Preparar estorno de {commercialQuantity(movement.quantity)}</Button>}
        </li>)}</ul> : <p>Nenhum movimento registrado para este produto.</p>}
        <div className="flex flex-wrap items-center justify-between gap-2"><Button variant="outline" disabled={!historyOffset || saving || uncertain} onClick={() => { setHistoryLoading(true); setHistoryOffset(value => value - 25) }}>Movimentos anteriores</Button><span className="text-sm">{history.total} registro(s)</span><Button variant="outline" disabled={historyOffset + 25 >= history.total || saving || uncertain} onClick={() => { setHistoryLoading(true); setHistoryOffset(value => value + 25) }}>Próximos movimentos</Button></div>
      </>}
    </section>}
  </div>
}
