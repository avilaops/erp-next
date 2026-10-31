"use client"

import { useEffect, useRef, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { decimalPattern, normalizeDecimal } from "@/lib/decimal-input"

type Job = { id: string; orderId: string; productId: string; sku: string; name: string; unit: string; quantity: string; stageId: string; stageName: string; stageKind: string; status: string; revision: number }
type Stage = { id: string; name: string; kind: string; position: number; revision: number }
type Consumption = { id: string; name: string; sku: string; unit: string; quantity: string; unitCost: string; amount: string; reversed: boolean }
type Detail = { tenantId: string; canEdit: boolean; canConsume: boolean; data: Job; history: { id: string; action: string; stageName: string; actor: string; createdAt: string }[]; consumptions: Consumption[] }
type List = { tenantId: string; canEdit: boolean; data: Job[]; total: number }
type SalesPage = { tenantId: string; data: { id: string; customerName: string; status: string; revision: number }[]; total: number }
type Stock = { productId: string; name: string; sku: string; unit: string; status: string; available: string }
type PendingCommand = { url: string; method: string; tenant: string; revision?: number; body: string; key: string }
const selectClass = "block h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm"
const statuses: Record<string, string> = { open: "Em andamento", ready: "Pronta", cancelled: "Cancelada" }
const actions: Record<string, string> = { "production.created": "Ordem criada", "production.stage_changed": "Etapa alterada", "production.consumed": "Consumo registrado", "production.consumption_reversed": "Consumo estornado", "production.cancelled": "Ordem cancelada" }
const statusLabel = (status: string) => statuses[status] || status
const actionLabel = (action: string) => actions[action] || action

async function read<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal })
  const value = await response.json()
  if (!response.ok) throw new Error(value.title || "Produção indisponível")
  return value as T
}

export function ProductionWorkspace({ id }: { id?: string }) {
  const [list, setList] = useState<List | null>(null)
  const [stages, setStages] = useState<Stage[]>([])
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState(id || "")
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [detailError, setDetailError] = useState("")
  const [refresh, setRefresh] = useState(0)
  const [detailLoading, setDetailLoading] = useState(Boolean(id))
  const [showCreate, setShowCreate] = useState(false)
  const [sales, setSales] = useState<SalesPage | null>(null)
  const [saleOffset, setSaleOffset] = useState(0)
  const [saleId, setSaleId] = useState("")
  const [saleError, setSaleError] = useState("")
  const [stocks, setStocks] = useState<Stock[]>([])
  const [stockQuery, setStockQuery] = useState("")
  const [stockError, setStockError] = useState("")
  const [draft, setDraft] = useState({ productId: "", quantity: "", unitCost: "", reason: "" })
  const [nextStage, setNextStage] = useState("")
  const [reversal, setReversal] = useState({ movement: "", reason: "" })
  const [stageId, setStageId] = useState("")
  const [stageDraft, setStageDraft] = useState({ name: "", kind: "andamento", position: "1" })
  const [saving, setSaving] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [writeError, setWriteError] = useState("")
  const [notice, setNotice] = useState("")
  const pending = useRef<PendingCommand | null>(null)
  const writing = useRef(false)
  const dirty = Boolean(draft.productId || draft.quantity || draft.unitCost || draft.reason || reversal.movement || stageDraft.name)
  const locked = saving || uncertain

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      read<List>(`/api/erp/production/orders?offset=${offset}&limit=25`, controller.signal),
      read<{ data: Stage[] }>("/api/erp/production/stages", controller.signal),
    ]).then(([orders, steps]) => {
      if (!controller.signal.aborted) { setList(orders); setStages(steps.data); setError("") }
    }).catch(reason => { if (!controller.signal.aborted) { setList(null); setError(reason.message) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [offset, refresh])

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    read<Detail>(`/api/erp/production/orders/${selected}`, controller.signal).then(value => {
      if (!controller.signal.aborted) { setDetail(value); setDetailError("") }
    }).catch(reason => { if (!controller.signal.aborted) { setDetail(null); setDetailError(reason.message) } })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false) })
    return () => controller.abort()
  }, [selected, refresh])

  useEffect(() => {
    if (!showCreate) return
    const controller = new AbortController()
    read<SalesPage>(`/api/erp/orders?offset=${saleOffset}&limit=25`, controller.signal).then(value => {
      if (!controller.signal.aborted) { setSales(value); setSaleError("") }
    }).catch(reason => { if (!controller.signal.aborted) { setSales(null); setSaleError(reason.message) } })
    return () => controller.abort()
  }, [showCreate, saleOffset, refresh])

  useEffect(() => {
    if (!detail?.canConsume) return
    const controller = new AbortController()
    const params = new URLSearchParams({ q: stockQuery, status: "active", limit: "100" })
    read<{ data: Stock[] }>(`/api/erp/stock?${params}`, controller.signal).then(value => {
      if (!controller.signal.aborted) { setStocks(value.data.filter(stock => stock.productId !== detail.data.productId)); setStockError("") }
    }).catch(reason => { if (!controller.signal.aborted) { setStocks([]); setStockError(reason.message) } })
    return () => controller.abort()
  }, [detail, stockQuery])

  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty || uncertain) event.preventDefault() }
    window.addEventListener("beforeunload", prevent)
    return () => window.removeEventListener("beforeunload", prevent)
  }, [dirty, uncertain])

  function choose(job: Job) {
    if (locked || (dirty && !window.confirm("Descartar os dados ainda não confirmados?"))) return
    setSelected(job.id); setDetail(null); setDetailLoading(true); setDetailError("")
    setDraft({ productId: "", quantity: "", unitCost: "", reason: "" }); setReversal({ movement: "", reason: "" }); setNextStage("")
    setNotice(""); setWriteError("")
  }

  async function send(command?: Omit<PendingCommand, "key" | "body"> & { body: unknown }) {
    if (writing.current) return
    if (!uncertain && command) pending.current = { ...command, body: JSON.stringify(command.body), key: crypto.randomUUID() }
    if (!pending.current) return
    writing.current = true; setSaving(true); setWriteError(""); setNotice("")
    try {
      const current = pending.current
      const response = await fetch(current.url, { method: current.method, headers: { "Content-Type": "application/json", "X-Tenant-Id": current.tenant, "Idempotency-Key": current.key, ...(current.revision ? { "If-Match": `"${current.revision}"` } : {}) }, body: current.body })
      const value = await response.json()
      if (!response.ok) {
        setUncertain(response.status >= 500)
        if (response.status < 500) pending.current = null
        throw new Error(value.title || "Operação recusada")
      }
      if (value.tenantId !== current.tenant || !value.data || !response.headers.get("etag")) {
        setUncertain(true)
        throw new Error("Resposta sem confirmação da empresa e da revisão. Confira a mesma operação antes de continuar.")
      }
      pending.current = null; setUncertain(false); setNotice("Operação confirmada.")
      if (current.url.includes("/consumptions")) { setDraft({ productId: "", quantity: "", unitCost: "", reason: "" }); setReversal({ movement: "", reason: "" }) }
      if (current.url.endsWith("/stage")) setNextStage("")
      if (current.url.includes("/production/stages")) { setStageDraft({ name: "", kind: "andamento", position: "1" }); setStageId("") }
      if (current.url === "/api/erp/production/orders") setSaleId("")
      setLoading(true); if (selected) setDetailLoading(true); setRefresh(value => value + 1)
    } catch (reason) {
      if (reason instanceof TypeError || reason instanceof SyntaxError) setUncertain(true)
      setWriteError(reason instanceof Error ? reason.message : "Não foi possível confirmar a operação")
    } finally { writing.current = false; setSaving(false) }
  }

  function consume(event: React.FormEvent) {
    event.preventDefault()
    if (!detail) return
    const quantity = normalizeDecimal(draft.quantity, 6); const unitCost = normalizeDecimal(draft.unitCost, 2)
    if (!quantity || /^0\.0+$/.test(quantity) || unitCost === null) { setWriteError("Informe quantidade positiva com até seis casas e custo com até duas casas."); return }
    void send({ url: `/api/erp/production/orders/${detail.data.id}/consumptions`, method: "POST", tenant: detail.tenantId, revision: detail.data.revision, body: { ...draft, quantity, unitCost } })
  }

  return <div className="mx-auto w-full min-w-0 max-w-[1600px] space-y-5 px-4 pb-24 pt-6 sm:px-6">
    <PageHeader eyebrow="Estoque" title="Ordens de produção" description="Etapas e consumo real de componentes por pedido da empresa ativa." />
    <p className="rounded-xl border p-4 text-sm text-muted-foreground">Cada ordem conserva o produto e a quantidade vendidos. Registre os componentes efetivamente consumidos. Marcar como pronta registra a conclusão; os consumos voltam ao estoque ao reabrir uma ordem pronta ou cancelar integralmente a venda.</p>
    {notice && <p role="status" className="rounded-xl border p-4">{notice}</p>}
    {writeError && <p role="alert" className="rounded-xl border p-4">{writeError}</p>}
    {uncertain && <div role="alert" className="space-y-3 rounded-xl border p-4"><p>A resposta não confirmou o resultado. Repita o mesmo comando para conferir sem duplicar a operação.</p><Button disabled={saving} onClick={() => void send()}>Repetir confirmação</Button></div>}
    <section className="form-section min-w-0 space-y-4" aria-label="Ordens registradas">
      <h2 className="font-semibold">Ordens registradas</h2>
      {loading ? <p role="status">Carregando produção…</p> : error ? <div role="alert"><p>{error}</p><Button variant="outline" onClick={() => { setLoading(true); setRefresh(value => value + 1) }}>Tentar novamente</Button></div> : list && <>
        <p>{list.total} ordem(ns) · {list.canEdit ? "Consulta e operação" : "Somente consulta"}</p>
        <div className="flex flex-wrap gap-3">{list.canEdit && <Button disabled={locked} onClick={() => setShowCreate(value => !value)}>Enviar pedido à produção</Button>}<Button variant="outline" disabled={locked} onClick={() => { setLoading(true); setRefresh(value => value + 1) }}>Recarregar produção</Button></div>
        {list.data.length ? <ul className="grid min-w-0 gap-3 sm:grid-cols-2">{list.data.map(job => <li key={job.id} className="min-w-0 rounded-xl border p-4">
          <button className="block max-w-full break-words text-left font-medium text-primary underline" disabled={locked} onClick={() => choose(job)}>Consultar {job.name}</button>
          <p className="mt-2 break-words">{job.quantity} {job.unit} · {job.sku}</p><p>{job.stageName} · {statusLabel(job.status)}</p>
          <p className="mt-1 break-all text-xs text-muted-foreground">Pedido {job.orderId}</p>
        </li>)}</ul> : <p>Nenhuma ordem registrada. Envie um pedido confirmado ou concluído para começar.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="outline" disabled={locked || !offset} onClick={() => { setLoading(true); setOffset(value => value - 25) }}>Anterior</Button><span>Página {offset / 25 + 1}</span><Button variant="outline" disabled={locked || offset + 25 >= list.total} onClick={() => { setLoading(true); setOffset(value => value + 25) }}>Próxima</Button></div>
      </>}
    </section>

    {showCreate && list?.canEdit && <section className="form-section min-w-0 space-y-4" aria-label="Enviar pedido à produção">
      <h2 className="font-semibold">Fabricar os produtos de um pedido</h2>
      {saleError ? <p role="alert">{saleError}</p> : !sales ? <p role="status">Carregando pedidos…</p> : <form onSubmit={event => { event.preventDefault(); const sale = sales.data.find(item => item.id === saleId); if (sale) void send({ url: "/api/erp/production/orders", method: "POST", tenant: sales.tenantId, revision: sale.revision, body: { orderId: sale.id } }) }} className="space-y-4">
        <fieldset disabled={locked} className="space-y-4"><label className="block space-y-2">Pedido confirmado ou concluído<select required className={selectClass} value={saleId} onChange={event => setSaleId(event.target.value)}><option value="">Selecione o pedido</option>{sales.data.filter(sale => ["confirmed", "completed"].includes(sale.status)).map(sale => <option key={sale.id} value={sale.id}>{sale.customerName} · {sale.id}</option>)}</select></label><Button type="submit" disabled={!saleId}>Criar ordens por produto</Button></fieldset>
        <div className="flex flex-wrap justify-between gap-3"><Button type="button" variant="outline" disabled={locked || !saleOffset} onClick={() => { setSales(null); setSaleId(""); setSaleOffset(value => value - 25) }}>Pedidos anteriores</Button><Button type="button" variant="outline" disabled={locked || saleOffset + 25 >= sales.total} onClick={() => { setSales(null); setSaleId(""); setSaleOffset(value => value + 25) }}>Próximos pedidos</Button></div>
      </form>}
    </section>}

    {selected && <section className="form-section min-w-0 space-y-5" aria-label="Ordem selecionada">
      {detailLoading ? <p role="status">Carregando ordem…</p> : detailError ? <p role="alert">{detailError}</p> : detail && <>
        <h2 className="break-words text-xl font-semibold">{detail.data.name}</h2>
        <p className="break-words">{detail.data.quantity} {detail.data.unit} · {detail.data.sku}</p><p>{detail.data.stageName} · {statusLabel(detail.data.status)}</p>
        <p className="break-all text-sm">Pedido {detail.data.orderId} · Revisão {detail.data.revision}</p>
        {detail.data.status === "cancelled" ? <p>Ordem cancelada. O histórico e os consumos permanecem disponíveis para consulta.</p> : detail.canEdit && <form className="grid min-w-0 gap-3 sm:grid-cols-[1fr_auto]" onSubmit={event => { event.preventDefault(); void send({ url: `/api/erp/production/orders/${selected}/stage`, method: "POST", tenant: detail.tenantId, revision: detail.data.revision, body: { stageId: nextStage } }) }}>
          <label className="space-y-2">Próxima etapa<select required disabled={locked} className={selectClass} value={nextStage} onChange={event => setNextStage(event.target.value)}><option value="">Selecione a etapa</option>{stages.filter(stage => stage.id !== detail.data.stageId).map(stage => <option value={stage.id} key={stage.id}>{stage.name}{stage.kind === "pronta" ? " · Pronta" : ""}</option>)}</select></label><Button className="self-end" type="submit" disabled={locked || !nextStage}>Mover ordem</Button>
        </form>}
        {detail.canConsume && detail.data.status === "open" && <div className="space-y-4 border-t pt-4">
          <h3 className="font-semibold">Consumo declarado por ordem</h3>
          <p className="text-sm text-muted-foreground">As quantidades e os custos declarados ficam no histórico desta ordem. A produção não lança entrada de produto acabado nem título financeiro.</p>
          <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); setStockQuery(String(new FormData(event.currentTarget).get("componentQuery") || "")) }}><label className="min-w-0 flex-1 space-y-2">Buscar componente no estoque<Input name="componentQuery" maxLength={160} disabled={locked} /></label><Button variant="outline" disabled={locked} type="submit">Buscar componente</Button></form>
          {stockError && <p role="alert">{stockError}</p>}
          <form className="space-y-4" onSubmit={consume}><fieldset disabled={locked} className="grid min-w-0 gap-4 sm:grid-cols-2">
            <label className="min-w-0 space-y-2 sm:col-span-2">Componente do estoque<select className={selectClass} required value={draft.productId} onChange={event => setDraft({ ...draft, productId: event.target.value })}><option value="">Selecione o componente</option>{stocks.map(stock => <option key={stock.productId} value={stock.productId}>{stock.name} · {stock.sku} · disponível {stock.available} {stock.unit}</option>)}</select></label>
            <label className="min-w-0 space-y-2">Quantidade consumida<Input required inputMode="decimal" pattern={decimalPattern(6)} maxLength={19} value={draft.quantity} onChange={event => setDraft({ ...draft, quantity: event.target.value })} /></label>
            <label className="min-w-0 space-y-2">Custo unitário declarado<Input required inputMode="decimal" pattern={decimalPattern(2)} maxLength={15} value={draft.unitCost} onChange={event => setDraft({ ...draft, unitCost: event.target.value })} /></label>
            <label className="min-w-0 space-y-2 sm:col-span-2">Motivo do consumo<Input required minLength={3} maxLength={500} value={draft.reason} onChange={event => setDraft({ ...draft, reason: event.target.value })} /></label>
            <Button className="w-fit" type="submit">Registrar consumo</Button>
          </fieldset></form>
        </div>}
        {!detail.canConsume && detail.canEdit && detail.data.status !== "cancelled" && <p>Registrar ou devolver componentes exige permissões de consulta e movimentação de estoque.</p>}
        <h3 className="font-semibold">Consumos registrados</h3>
        {detail.consumptions.length ? <ul className="space-y-3">{detail.consumptions.map(consumption => <li className="min-w-0 space-y-2 rounded-xl border p-4" key={consumption.id}><p className="break-words font-medium">{consumption.name} · {consumption.sku}</p><p>{consumption.quantity} {consumption.unit} · custo unitário R$ {consumption.unitCost} · total R$ {consumption.amount}</p><p>{consumption.reversed ? "Estornado" : "Consumo ativo"}</p>{!consumption.reversed && detail.canConsume && detail.data.status !== "cancelled" && <Button variant="outline" disabled={locked} onClick={() => setReversal({ movement: consumption.id, reason: "" })}>Estornar consumo de {consumption.name}</Button>}</li>)}</ul> : <p>Nenhum consumo registrado nesta ordem.</p>}
        {reversal.movement && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void send({ url: `/api/erp/production/orders/${selected}/consumptions/${reversal.movement}/reverse`, method: "POST", tenant: detail.tenantId, revision: detail.data.revision, body: { reason: reversal.reason } }) }}><label className="block space-y-2">Motivo do estorno do consumo<Input required minLength={3} maxLength={500} disabled={locked} value={reversal.reason} onChange={event => setReversal({ ...reversal, reason: event.target.value })} /></label><Button disabled={locked}>Confirmar estorno do consumo</Button></form>}
        <h3 className="font-semibold">Histórico da ordem</h3>
        {detail.history.length ? <ol className="space-y-3">{detail.history.map(item => <li className="min-w-0 rounded-xl border p-4" key={item.id}><p>{actionLabel(item.action)} · {item.stageName}</p><p className="break-words text-sm text-muted-foreground">{new Date(item.createdAt).toLocaleString("pt-BR")} · {item.actor}</p></li>)}</ol> : <p>Nenhum evento disponível.</p>}
      </>}
      <Button variant="outline" disabled={locked} onClick={() => { setDetailLoading(true); setRefresh(value => value + 1) }}>Recarregar ordem</Button>
    </section>}

    {list?.canEdit && <details className="form-section min-w-0 space-y-4"><summary className="cursor-pointer font-semibold">Configurar etapas da produção</summary>
      <p className="text-sm text-muted-foreground">As etapas iniciais são A produzir, Corte, Solda, Pintura, Montagem e Pronto. O nome anterior permanece no histórico quando uma etapa é renomeada.</p>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); const stage = stages.find(item => item.id === stageId); void send({ url: `/api/erp/production/stages${stage ? `/${stage.id}` : ""}`, method: stage ? "PUT" : "POST", tenant: list.tenantId, revision: stage?.revision, body: { name: stageDraft.name, kind: stageDraft.kind, position: Number(stageDraft.position) } }) }}><fieldset disabled={locked} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <label className="space-y-2 sm:col-span-2">Etapa para configurar<select className={selectClass} value={stageId} onChange={event => { const stage = stages.find(item => item.id === event.target.value); setStageId(event.target.value); setStageDraft(stage ? { name: stage.name, kind: stage.kind, position: String(stage.position) } : { name: "", kind: "andamento", position: "1" }) }}><option value="">Nova etapa em andamento</option>{stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>
        <label className="space-y-2">Nome da etapa<Input required minLength={2} maxLength={40} value={stageDraft.name} onChange={event => setStageDraft({ ...stageDraft, name: event.target.value })} /></label>
        <label className="space-y-2">Posição na sequência<Input required type="number" min={1} max={10000} step={1} value={stageDraft.position} onChange={event => setStageDraft({ ...stageDraft, position: event.target.value })} /></label>
        <Button className="w-fit" type="submit">Salvar etapa</Button>
      </fieldset></form>
    </details>}
  </div>
}
