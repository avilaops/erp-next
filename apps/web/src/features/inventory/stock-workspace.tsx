"use client"

import { erpFetch } from "@/lib/api/client"

import type { Schema } from "@/lib/api/types"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { decimalPattern, normalizeDecimal } from "@/lib/decimal-input"

type Stock = Schema<"Stock">
type Movement = Schema<"Movement">
type StockList = Schema<"StockList">
type History = Schema<"MovementList">
type Draft = { direction: "receipt" | "issue"; quantity: string; reason: string }
const blank: Draft = { direction: "receipt", quantity: "", reason: "" }
const selectClass = "block h-9 w-full min-w-0 rounded-lg border bg-background px-3 text-sm"

export function StockWorkspace() {
  const [query, setQuery] = useState({ q: "", offset: 0 })
  const [stocks, setStocks] = useState<StockList | null>(null)
  const [loading, setLoading] = useState(true)
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
    const params = new URLSearchParams({ q: query.q, offset: String(query.offset), limit: "25" })
    erpFetch(`/api/erp/stock?${params}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Estoque indisponível")
      if (!controller.signal.aborted) { setStocks(value); setListError("") }
    }).catch(error => { if (!controller.signal.aborted) { setStocks(null); setListError(error.message) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [query, refresh])

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
      setNotice(`Movimento confirmado. Saldo após o lançamento: ${value.balanceAfter} ${selected.unit}.`)
      setSelected({ ...selected, quantity: value.balanceAfter }); setHistoryOffset(0)
      setHistoryLoading(true); setLoading(true); setRefresh(value => value + 1)
    } catch (error) {
      // A lost response can follow a committed transaction: preserve the exact command for retry.
      if (error instanceof TypeError || error instanceof SyntaxError) setUncertain(true)
      setWriteError(error instanceof Error ? error.message : "Não foi possível confirmar o lançamento")
    } finally { pending.current = false; setSaving(false) }
  }

  return <div className="mx-auto w-full min-w-0 max-w-[1600px] px-4 pb-24 pt-6 sm:px-6">
    <PageHeader eyebrow="Estoque" title="Saldos e movimentos" description="Entradas, saídas e estornos da empresa ativa. Quantidades com até seis casas decimais." />
    <section className="form-section min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Saldos por produto</h2><Link className="text-primary underline" href="/cadastros/produtos">Consultar catálogo</Link></div>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
        event.preventDefault(); setLoading(true)
        setQuery({ q: String(new FormData(event.currentTarget).get("q") || ""), offset: 0 })
      }}>
        <label className="min-w-0 flex-1 space-y-2">Buscar produto ou SKU<Input name="q" maxLength={160} /></label>
        <Button type="submit" disabled={loading}>Buscar</Button>
      </form>
      {loading ? <p role="status">Carregando saldos…</p> : listError ? <div role="alert" className="space-y-3"><p>{listError}</p><Button variant="outline" onClick={() => { setLoading(true); setRefresh(value => value + 1) }}>Tentar novamente</Button></div> : stocks && <>
        <p className="text-sm text-muted-foreground">{stocks.total} produto(s) · {stocks.canEdit ? "Consulta e movimentação" : "Somente consulta"}</p>
        {stocks.data.length ? <ul className="grid gap-3 sm:grid-cols-2">{stocks.data.map(stock => <li className="min-w-0" key={stock.productId}>
          <button className="h-full w-full rounded-xl border p-4 text-left hover:border-primary disabled:opacity-60" disabled={saving || uncertain} aria-pressed={selected?.productId === stock.productId} onClick={() => choose(stock)}>
            <strong className="block break-words">{stock.name}</strong><span className="block break-all text-sm text-muted-foreground">SKU {stock.sku} · {stock.status === "active" ? "Ativo" : "Arquivado"}</span>
            <span className="mt-2 block break-all font-medium">Saldo: {stock.quantity} {stock.unit}</span>
            <span className="mt-1 block break-all text-sm">Reservado: {stock.reserved} · Disponível: {stock.available}</span>
          </button>
        </li>)}</ul> : <p>Nenhum produto encontrado. Cadastre um produto para movimentar o estoque.</p>}
        <div className="flex items-center justify-between gap-2"><Button variant="outline" disabled={!query.offset} onClick={() => { setLoading(true); setQuery({ ...query, offset: query.offset - 25 }) }}>Anterior</Button><span className="text-sm">Página {query.offset / 25 + 1}</span><Button variant="outline" disabled={query.offset + 25 >= stocks.total} onClick={() => { setLoading(true); setQuery({ ...query, offset: query.offset + 25 }) }}>Próxima</Button></div>
      </>}
    </section>

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
        {history.data.length ? <ul className="space-y-3">{history.data.map(movement => <li key={movement.id} className="min-w-0 space-y-2 rounded-xl border p-4">
          <p className="break-words font-medium">{movement.reversesId ? "Estorno · " : ""}{movement.direction === "receipt" ? "Entrada" : "Saída"} de {movement.quantity} {selected.unit}</p>
          <p className="break-words text-sm">{movement.reason}</p>
          <p className="break-all text-sm text-muted-foreground">Saldo após: {movement.balanceAfter} · Registro: {movement.occurredAt}</p>
          <p className="break-all text-xs text-muted-foreground">ID: {movement.id}{movement.reversesId && ` · Estorna: ${movement.reversesId}`}</p>
          {movement.sourceOrderId && <p className="break-all text-sm text-muted-foreground">Pedido de origem: {movement.sourceOrderId}. Devolução ainda não disponível.</p>}
          {history.canEdit && !movement.reversesId && !movement.sourceOrderId && <Button variant="outline" disabled={saving || uncertain || selected.status !== "active" || Boolean(reversal)} onClick={() => {
            if (dirty && !window.confirm("Substituir o lançamento em edição por um estorno?")) return
            setReversal(movement); setDraft({ direction: movement.direction === "receipt" ? "issue" : "receipt", quantity: movement.quantity, reason: "" }); setWriteError(""); setNotice("")
          }}>Preparar estorno de {movement.quantity}</Button>}
        </li>)}</ul> : <p>Nenhum movimento registrado para este produto.</p>}
        <div className="flex flex-wrap items-center justify-between gap-2"><Button variant="outline" disabled={!historyOffset || saving || uncertain} onClick={() => { setHistoryLoading(true); setHistoryOffset(value => value - 25) }}>Movimentos anteriores</Button><span className="text-sm">{history.total} registro(s)</span><Button variant="outline" disabled={historyOffset + 25 >= history.total || saving || uncertain} onClick={() => { setHistoryLoading(true); setHistoryOffset(value => value + 25) }}>Próximos movimentos</Button></div>
      </>}
    </section>}
  </div>
}
