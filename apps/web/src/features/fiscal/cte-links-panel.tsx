"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatCteMoney } from "./cte-inspection-model"
import { buildCteLinkInput, cteLinkReason } from "./cte-links-model"
import { CteLinkFailure, readCteLinks, readCteOptions, sendCteLinkCommand } from "./cte-links"
import type { CteInspectionView } from "./cte-inspection-model"
import type { CteLinkKind, CteLinks, CteOptions } from "./cte-links-model"
import type { CteLinkCommand, VerifyCteAccess } from "./cte-links"

type Order = CteOptions["data"][number]
const labels = { purchase: "compra", sale: "venda" }
const status: Record<string, string> = { confirmed: "Confirmado", completed: "Concluído", partially_received: "Recebido parcialmente", received: "Recebido", closed: "Encerrado" }

export function CteLinksPanel({ inspected, verifyAccess, accessUnavailable, disabled, onBusy }: { inspected: CteInspectionView; verifyAccess: VerifyCteAccess; accessUnavailable: boolean; disabled: boolean; onBusy: (value: boolean) => void }) {
  const [opened, setOpened] = useState(false)
  const [view, setView] = useState<CteLinks | null>(null)
  const [options, setOptions] = useState<CteOptions | null>(null)
  const [kind, setKind] = useState<CteLinkKind | null>(null)
  const [selected, setSelected] = useState<Order | null>(null)
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [reviewed, setReviewed] = useState(false)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [removeReason, setRemoveReason] = useState("")
  const [pending, setPending] = useState(false)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const operation = useRef<AbortController | null>(null)
  const command = useRef<CteLinkCommand | null>(null)

  useEffect(() => () => { operation.current?.abort(); command.current = null; onBusy(false) }, [onBusy])

  function clearDraft() { setOptions(null); setKind(null); setSelected(null); setAmount(""); setReason(""); setReviewed(false); setRemoveId(null); setRemoveReason("") }
  async function run(label: string, action: (signal: AbortSignal) => Promise<void>) {
    if (disabled || operation.current) return
    const controller = new AbortController()
    operation.current = controller
    setBusy(label); setError(""); setNotice(""); onBusy(true)
    try { await action(controller.signal) }
    catch (error) {
      if (!controller.signal.aborted) {
        const failure = error instanceof CteLinkFailure ? error : new CteLinkFailure(error instanceof Error ? error.message : "Não foi possível confirmar os vínculos")
        setError(failure.message)
        if (failure.contextInvalid) { command.current = null; setPending(false); setView(null); clearDraft() }
        else if (command.current && (!failure.status || failure.status >= 500)) { setPending(true); setView(null); setOptions(null) }
        else {
          command.current = null; setPending(false); setReviewed(false)
          if (failure.status === 409 || failure.status === 412 || label === "read") setView(null)
          if (label === "options") setOptions(null)
        }
      }
    } finally {
      operation.current = null
      if (!controller.signal.aborted) { setBusy(""); onBusy(command.current !== null) }
    }
  }
  function refresh() {
    setOpened(true)
    void run("read", async signal => { setView(await readCteLinks(inspected, verifyAccess, signal)) })
  }
  function chooseKind(value: CteLinkKind, offset = 0) {
    if (pending) return
    setKind(value); setOptions(null); setSelected(null); setReviewed(false); setRemoveId(null)
    void run("options", async signal => { setOptions(await readCteOptions(inspected, verifyAccess, signal, value, offset)) })
  }
  async function execute(current: CteLinkCommand, signal: AbortSignal) {
    const result = await sendCteLinkCommand(inspected, verifyAccess, signal, current)
    command.current = null; setPending(false); setView(result); clearDraft()
    if (current.action === "unlink") setNotice("Vínculo desfeito. O histórico foi preservado; pedidos, estoque e financeiro não foram alterados.")
    else {
      const active = result.data.some(row => row.kind === current.kind && row.orderId === current.input.orderId && row.freightCents === current.input.freightCents && row.reason === current.input.reason)
      setNotice(active ? "Vínculo comercial registrado. Pedidos, estoque e financeiro foram preservados." : "Comando já processado. Confira os vínculos ativos abaixo; o histórico foi preservado.")
    }
  }
  function confirm() {
    if (!view || !kind || !selected || pending) return
    let input
    try {
      input = buildCteLinkInput(kind, selected.id, view.carrier.partyId ?? null, amount, reason, reviewed)
      if (BigInt(view.allocatedCents) + BigInt(input.freightCents) > BigInt(view.serviceCents)) throw new Error("O frete associado ultrapassa o valor disponível da prestação")
    } catch (error) { setError(error instanceof Error ? error.message : "Confira os dados do vínculo"); return }
    const frozen = Object.freeze(input), revision = view.revision
    void run("link", async signal => {
      const current = await verifyAccess(signal)
      const next: CteLinkCommand = Object.freeze({ action: "link", kind, input: frozen, tenantId: current.id, subject: current.subject, documentId: inspected.documentId, hash: inspected.sourceXmlSha256, revision, key: crypto.randomUUID(), body: JSON.stringify(frozen) })
      command.current = next
      await execute(next, signal)
    })
  }
  function unlink() {
    const row = view?.data.find(row => row.id === removeId)
    if (!row || !row.canUnlink || !view || pending) return
    let reason: string
    try { reason = cteLinkReason(removeReason) } catch (error) { setError(error instanceof Error ? error.message : "Informe o motivo"); return }
    const revision = view.revision
    void run("unlink", async signal => {
      const current = await verifyAccess(signal)
      const next: CteLinkCommand = Object.freeze({ action: "unlink", linkId: row.id, kind: row.kind, tenantId: current.id, subject: current.subject, documentId: inspected.documentId, hash: inspected.sourceXmlSha256, revision, key: crypto.randomUUID(), body: JSON.stringify({ reason }) })
      command.current = next
      await execute(next, signal)
    })
  }
  const blocked = disabled || !!busy
  const canSelect = !!view?.canLinkPurchase || !!view?.canLinkSale
  const canSubmit = !blocked && !pending && !!view && !!selected && !!kind && reviewed && !!amount.trim() && !!reason.trim()

  if (!opened) return <Button variant="outline" disabled={disabled || !!busy} onClick={refresh}>Ver vínculos comerciais</Button>
  return <section aria-label="Vínculos comerciais do CT-e" className="min-w-0 space-y-4 rounded-lg border p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-semibold">Vínculos comerciais do CT-e</h4><Button variant="outline" disabled={blocked} onClick={refresh}>Atualizar vínculos</Button></div>
    <p className="text-sm text-muted-foreground">Associe apenas pedidos existentes após conferir transportadora, valores e documentos. O vínculo registra sua conferência; não lança custo, estoque ou financeiro e não comprova a situação fiscal externa.</p>
    {busy && <p role="status">{busy === "options" ? "Consultando pedidos…" : "Confirmando vínculos…"}</p>}
    {error && <p role="alert" className="break-words text-destructive">{error}</p>}
    {notice && <p role="status" className="break-words">{notice}</p>}
    {pending && <div className="space-y-3 rounded-lg bg-muted/40 p-3"><p>Uma operação ficou sem resposta confirmada. Repita para verificar o resultado.</p><Button disabled={blocked} onClick={() => { const current = command.current; if (current) void run("retry", signal => execute(current, signal)) }}>Repetir confirmação</Button></div>}
    {view && !accessUnavailable && <>
      <dl className="grid gap-3 sm:grid-cols-3"><div><dt className="text-muted-foreground">Prestação do CT-e</dt><dd>{formatCteMoney(view.serviceCents)}</dd></div><div><dt className="text-muted-foreground">Frete associado</dt><dd>{formatCteMoney(view.allocatedCents)}</dd></div><div><dt className="text-muted-foreground">Disponível para associar</dt><dd>{formatCteMoney((BigInt(view.serviceCents) - BigInt(view.allocatedCents)).toString())}</dd></div></dl>
      <div className="min-w-0"><p className="text-muted-foreground">Transportadora da conferência</p><p className="break-words">{view.carrier.name}{view.carrier.ownCompany ? " · Própria empresa" : ""}</p><p className="break-all">CNPJ {view.carrier.taxId}</p></div>
      {!view.data.length && <p>Nenhum vínculo comercial ativo.</p>}
      <ul className="space-y-3">{view.data.map(row => <li key={row.id} className="min-w-0 space-y-2 rounded-lg bg-muted/40 p-3">
        <p className="font-medium">{row.kind === "purchase" ? "Compra" : "Venda"}</p>
        {row.restricted ? <p>Pedido com acesso restrito</p> : <><p className="break-words">{row.counterpartyName}</p><p>Valor registrado do pedido: {formatCteMoney(row.orderAmountCents)}</p><p className="break-words">Conferência: {row.reason}</p>{row.orderId && <Link className="text-primary underline" href={`/${row.kind === "purchase" ? "compras" : "vendas"}/pedidos/${row.orderId}`}>Abrir pedido {row.orderId.slice(0, 8)}</Link>}</>}
        <p>Frete deste vínculo: {formatCteMoney(row.freightCents)}</p>
        <p className="text-muted-foreground">Registrado em {new Date(row.createdAt).toLocaleString("pt-BR")}</p>
        {row.canUnlink && !pending && <Button variant="outline" disabled={blocked} onClick={() => { setRemoveId(row.id); setRemoveReason(""); setError(""); setNotice("") }}>Desfazer vínculo</Button>}
        {removeId === row.id && !pending && <form className="space-y-3" onSubmit={event => { event.preventDefault(); unlink() }}><label className="block space-y-2">Motivo do desfazimento<Input value={removeReason} maxLength={500} disabled={blocked} onChange={event => setRemoveReason(event.target.value)} /></label><div className="flex flex-wrap gap-2"><Button type="submit" disabled={blocked || !removeReason.trim()}>Confirmar desfazimento</Button><Button type="button" variant="outline" disabled={blocked} onClick={() => setRemoveId(null)}>Manter vínculo</Button></div></form>}
      </li>)}</ul>
      {!canSelect && <p className="text-muted-foreground">Seu acesso permite apenas consultar estes vínculos.</p>}
      {canSelect && !pending && <>
        {!view.carrier.available && <p>Cadastre uma transportadora ativa com o mesmo CNPJ do XML em <Link className="text-primary underline" href="/cadastros/clientes-fornecedores">Clientes e fornecedores</Link> e atualize os vínculos.</p>}
        <div className="flex flex-wrap gap-2">{view.canLinkPurchase && <Button variant="outline" disabled={blocked || !view.carrier.available || view.data.length >= 50} onClick={() => chooseKind("purchase")}>Selecionar compra</Button>}{view.canLinkSale && <Button variant="outline" disabled={blocked || !view.carrier.available || view.data.length >= 50} onClick={() => chooseKind("sale")}>Selecionar venda</Button>}</div>
        {view.data.length >= 50 && <p>Este CT-e atingiu 50 vínculos ativos. Desfaça um vínculo incorreto antes de associar outro pedido.</p>}
      </>}
    </>}
    {options && !pending && !accessUnavailable && <div className="min-w-0 space-y-3 rounded-lg border p-3" aria-label="Pedidos disponíveis para conferência">
      <p>Confira a {labels[options.kind]} antes de selecionar.</p>
      <ul className="space-y-2">{options.data.map(row => <li key={row.id}><Button className="h-auto max-w-full whitespace-normal break-words text-left" variant="outline" disabled={blocked} onClick={() => { setSelected(row); setOptions(null); setReviewed(false) }}>Selecionar {labels[options.kind]} · {row.counterpartyName} · {formatCteMoney(row.amountCents)} · {status[row.status]} · {row.dueDate} · {row.id.slice(0, 8)}</Button></li>)}</ul>
      {!options.data.length && <p>Nenhum pedido disponível nesta página. Verifique a situação dos pedidos existentes.</p>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={blocked || options.offset === 0} onClick={() => chooseKind(options.kind, Math.max(0, options.offset - options.limit))}>Pedidos anteriores</Button><Button variant="outline" disabled={blocked || options.offset + options.limit >= options.total || options.offset + options.limit > 100000} onClick={() => chooseKind(options.kind, options.offset + options.limit)}>Próximos pedidos</Button></div>
    </div>}
    {selected && kind && !pending && !accessUnavailable && <form className="min-w-0 space-y-4 rounded-lg border p-3" onSubmit={event => { event.preventDefault(); confirm() }}>
      <div className="min-w-0"><p className="font-medium">{kind === "purchase" ? "Compra selecionada" : "Venda selecionada"}</p><p className="break-words">{selected.counterpartyName} · {formatCteMoney(selected.amountCents)}</p><p className="break-all text-muted-foreground">Pedido {selected.id.slice(0, 8)} · {status[selected.status]} · Vencimento {selected.dueDate}</p></div>
      <label className="block space-y-2">Frete associado (R$)<Input inputMode="decimal" value={amount} disabled={blocked} maxLength={20} placeholder="Ex.: 150,01" onChange={event => { setAmount(event.target.value); setReviewed(false) }} /></label>
      <label className="block space-y-2">Motivo da conferência<Input value={reason} disabled={blocked} maxLength={500} onChange={event => { setReason(event.target.value); setReviewed(false) }} /></label>
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 size-4 shrink-0" checked={reviewed} disabled={blocked} onChange={event => setReviewed(event.target.checked)} /><span>Conferi a transportadora e o pedido</span></label>
      {!view && <p>Atualize os vínculos antes de reconferir e confirmar esta edição.</p>}
      <Button type="submit" disabled={!canSubmit}>Confirmar vínculo</Button>
    </form>}
  </section>
}
