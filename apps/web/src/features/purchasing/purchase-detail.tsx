"use client"

import { decimalPattern } from "@/lib/decimal-input"

import { RequestError } from "@/components/feedback/session-recovery"

import Link from "next/link"
import { useState, type FormEvent } from "react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Access } from "@/features/access/access-client"
import { quantity, useCommand, useResource } from "@/hooks/use-operation"
import { CommercialReturn } from "@/features/returns/commercial-return"
import { fixedText, fixedValue, money, purchaseLabels, purchaseLink, type PurchaseDetail as Detail, type ReceiptDetail, type ReceiptList } from "./purchase-types"

type PendingAction = { resource: string; body: object; notice: string }

export function PurchaseDetail({ id }: { id: string }) {
  const result = useResource<Detail>(`/api/erp/purchase-orders/${id}`)
  const access = useResource<Access>("/api/erp/me")
  const command = useCommand()
  const [notice, setNotice] = useState("")
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [reason, setReason] = useState("")
  const [receiptsRevision, setReceiptsRevision] = useState(0)
  const value = result.value
  const frozen = command.busy || command.uncertain || command.stale || result.loading
  const canReceive = value && access.value?.tenant.id === value.tenantId && ["purchasing.receipts.create", "inventory.stock.manage", "finance.payables.originate"].every(permission => access.value!.permissions.includes(permission))
  async function execute(action: PendingAction) {
    if (!value || !result.etag) return
    setPending(action); setNotice("")
    const response = await command.send<Detail | { order: Detail; receipt: ReceiptDetail }>(`/api/erp/purchase-orders/${id}/${action.resource}`, value.tenantId, action.body, result.etag)
    if (response) { setNotice(action.notice); setPending(null); setReason(""); setReceiptsRevision(previous => previous + 1); result.reload() }
  }
  return <>
    <PageHeader eyebrow="Compras" title="Pedido de compra" description="Confirmar fixa a compra. Cada recebimento registra a entrada de estoque e a obrigação financeira na mesma operação." />
    <Link className={purchaseLink} href="/compras/pedidos">Voltar às compras</Link>
    <section className="form-section mt-5 min-w-0 space-y-5">
      {notice && <p role="status">{notice}</p>}
      {result.loading ? <p role="status">Carregando compra…</p> : result.error ? <div role="alert"><p><RequestError message={result.error} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button></div> : value && <>
        <h2 className="break-words text-lg font-semibold">{value.data.supplierName}</h2>
        <p>Situação: {purchaseLabels[value.data.status] || value.data.status}</p><p>Total: {money(value.data.amount)}</p><p>Vencimento: {value.data.dueDate} · Revisão {value.data.revision}</p>
        <ul className="space-y-3">{value.items.map(item => <li className="min-w-0 space-y-2 rounded-xl border p-4" key={item.productId}><strong className="block break-words">{item.name}</strong><p>SKU {item.sku}</p><p>Pedido: {item.quantity} {item.unit} · Recebido: {item.receivedQuantity} {item.unit}</p><p>Custo unitário: {money(item.unitCost)} · Total: {money(item.amount)}</p></li>)}</ul>
        {!value.canEdit && <p>Sem permissão para alterar o pedido.</p>}
        {command.error && <p role="alert"><RequestError message={command.error} status={command.status} /></p>}
        {command.stale && <Button variant="outline" onClick={() => { if (window.confirm("Descartar os dados da operação em edição e recarregar a compra atual?")) { command.reset(); setPending(null); setReason(""); result.reload() } }}>Recarregar compra</Button>}
        {command.uncertain && <div className="space-y-3"><p role="status">O resultado ainda não foi confirmado. Repita a mesma operação para conferir, sem gerar outro recebimento.</p><Button disabled={command.busy || !pending} onClick={() => pending && execute(pending)}>Repetir confirmação da compra</Button></div>}
        {value.canEdit && <div className="space-y-4">
          {value.data.status === "draft" && <div className="flex flex-wrap items-center gap-4">{!frozen && <Link className={purchaseLink} href={`/compras/pedidos/${id}/editar`}>Editar rascunho</Link>}<Button disabled={frozen || !result.etag} onClick={() => { if (window.confirm("Confirmar este pedido de compra? Isso não envia mensagem ao fornecedor nem registra entrada de estoque.")) void execute({ resource: "confirm", body: {}, notice: "Compra confirmada. Registre o recebimento quando os produtos forem entregues." }) }}>Confirmar pedido de compra</Button></div>}
          {(["draft", "confirmed"].includes(value.data.status) && value.receiptCount === 0 || value.data.status === "partially_received") && <form className="space-y-3" onSubmit={event => {
            event.preventDefault()
            const closing = value.data.status === "partially_received"
            if (window.confirm(closing ? "Encerrar apenas o saldo ainda não recebido? Os recebimentos, o estoque e as contas existentes serão preservados." : "Cancelar este pedido de compra?")) void execute({ resource: closing ? "close" : "cancel", body: { reason }, notice: closing ? "Saldo da compra encerrado." : "Compra cancelada." })
          }}><label className="block min-w-0 space-y-2">Motivo do cancelamento ou encerramento<Input required minLength={3} maxLength={200} disabled={frozen} value={reason} onChange={event => setReason(event.target.value)} /></label><Button type="submit" variant="outline" disabled={frozen || !result.etag}>{value.data.status === "partially_received" ? "Encerrar saldo pendente" : "Cancelar compra"}</Button></form>}
        </div>}
        {["confirmed", "partially_received"].includes(value.data.status) && <>
          {access.loading ? <p role="status">Consultando permissão de recebimento…</p> : access.error ? <div role="alert"><p><RequestError message={access.error} status={access.status} /></p><Button onClick={access.reload}>Consultar permissões novamente</Button></div> : canReceive ? <ReceiveForm key={result.etag} order={value} disabled={frozen || !result.etag} submit={body => execute({ resource: "receipts", body, notice: "Recebimento registrado com entrada de estoque e conta a pagar, quando houver valor." })} /> : <p>O recebimento exige permissões de receber compras, movimentar estoque e originar contas a pagar.</p>}
        </>}
        <PurchaseReceipts key={receiptsRevision} id={id} />
      </>}
    </section>
  </>
}

function ReceiveForm({ order, disabled, submit }: { order: Detail; disabled: boolean; submit: (body: object) => Promise<void> }) {
  const [reference, setReference] = useState("")
  const [occurredOn, setOccurredOn] = useState("")
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [error, setError] = useState("")
  const remaining = order.items.filter(item => item.quantity !== item.receivedQuantity)
  async function receive(event: FormEvent) {
    event.preventDefault(); setError("")
    const items: { productId: string; quantity: string }[] = []
    for (const item of remaining) {
      const raw = amounts[item.productId] || ""
      if (!raw) continue
      const value = fixedValue(raw, 6)
      const available = fixedValue(item.quantity, 6)! - fixedValue(item.receivedQuantity, 6)!
      if (value === null || value <= BigInt(0) || value > available) { setError(`Informe uma quantidade positiva de ${item.name}, até ${fixedText(available, 6)}.`); return }
      items.push({ productId: item.productId, quantity: quantity(raw)! })
    }
    if (!items.length) { setError("Informe a quantidade recebida de pelo menos um produto."); return }
    if (window.confirm("Registrar as quantidades recebidas, a entrada no estoque e a conta a pagar correspondente?")) await submit({ reference, occurredOn, items })
  }
  return <form className="min-w-0 space-y-4 border-t pt-5" onSubmit={receive}>
    <h3 className="font-semibold">Registrar recebimento</h3><p className="text-sm text-muted-foreground">Preencha somente os produtos entregues nesta remessa. Deixe os demais em branco.</p>
    <fieldset disabled={disabled} className="grid min-w-0 gap-4 sm:grid-cols-2">
      <label className="min-w-0 space-y-2">Referência do recebimento<Input required minLength={3} maxLength={200} value={reference} onChange={event => setReference(event.target.value)} /></label>
      <label className="min-w-0 space-y-2">Data do recebimento<Input required type="date" value={occurredOn} onChange={event => setOccurredOn(event.target.value)} /></label>
      {remaining.map(item => <label className="min-w-0 space-y-2" key={item.productId}>Receber {item.name}<span className="block text-sm text-muted-foreground">Saldo: {fixedText(fixedValue(item.quantity, 6)! - fixedValue(item.receivedQuantity, 6)!, 6)} {item.unit}</span><Input inputMode="decimal" pattern={decimalPattern(6)} maxLength={19} value={amounts[item.productId] || ""} onChange={event => setAmounts(previous => ({ ...previous, [item.productId]: event.target.value }))} /></label>)}
    </fieldset>
    {error && <p role="alert">{error}</p>}
    <Button className="h-auto max-w-full whitespace-normal" type="submit" disabled={disabled}>Registrar entrada e conta a pagar</Button>
  </form>
}

function PurchaseReceipts({ id }: { id: string }) {
  const [offset, setOffset] = useState(0)
  const result = useResource<ReceiptList>(`/api/erp/purchase-orders/${id}/receipts?offset=${offset}&limit=25`)
  return <section className="min-w-0 space-y-3 border-t pt-5"><h3 className="font-semibold">Recebimentos registrados</h3>
    {result.loading ? <p role="status">Carregando recebimentos…</p> : result.error ? <div role="alert"><p><RequestError message={result.error} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button></div> : <>
      {!result.value?.data.length && <p>Nenhum recebimento registrado.</p>}
      <ul className="space-y-3">{result.value?.data.map(receipt => <li className="min-w-0 space-y-2 rounded-xl border p-4" key={receipt.id}><Link className={`${purchaseLink} break-words`} href={`/compras/recebimentos/${receipt.id}`}>Recebimento {receipt.reference}</Link><p>{receipt.occurredOn} · {money(receipt.amount)}</p>{receipt.reversalId && <p>Situação: Estornado</p>}{receipt.payableId && <Link className={purchaseLink} href={`/financeiro/contas-pagar/${receipt.payableId}`}>Consultar conta a pagar</Link>}</li>)}</ul>
      <div className="flex flex-wrap justify-between gap-3"><Button variant="outline" disabled={!offset} onClick={() => setOffset(value => value - 25)}>Recebimentos anteriores</Button><Button variant="outline" disabled={offset + 25 >= (result.value?.total || 0)} onClick={() => setOffset(value => value + 25)}>Próximos recebimentos</Button></div>
    </>}
  </section>
}

export function PurchaseReceipt({ id }: { id: string }) {
  const result = useResource<ReceiptDetail>(`/api/erp/purchase-receipts/${id}`)
  const [notice, setNotice] = useState("")
  return <><PageHeader eyebrow="Compras" title="Recebimento de compra" description="Registro da entrada física e da obrigação financeira originada pelo recebimento." />
    <section className="form-section min-w-0 space-y-4">{notice && <p role="status">{notice}</p>}{result.loading ? <p role="status">Carregando recebimento…</p> : result.error ? <div role="alert"><p><RequestError message={result.error} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button></div> : result.value && <ReceiptContent receipt={result.value} reload={result.reload} reversed={() => { setNotice("Recebimento estornado com estoque e conta a pagar reconciliados."); result.reload() }} />}</section>
  </>
}

function ReceiptContent({ receipt, reload, reversed }: { receipt: ReceiptDetail; reload: () => void; reversed: () => void }) {
  const order = useResource<Detail>(`/api/erp/purchase-orders/${receipt.data.orderId}`)
  const access = useResource<Access>("/api/erp/me")
  return <><h2 className="break-words font-semibold">{receipt.data.reference}</h2><p>Data: {receipt.data.occurredOn} · Valor: {money(receipt.data.amount)}</p>
    <p>Situação: {receipt.data.reversalId ? "Estornado" : "Registrado"}</p>
    <Link className={purchaseLink} href={`/compras/pedidos/${receipt.data.orderId}`}>Consultar pedido de compra</Link>
    {order.error && <p role="alert"><RequestError message={order.error} status={order.status} /></p>}
    <ul className="space-y-3">{receipt.items.map(item => <li className="rounded-xl border p-4" key={item.productId}><p className="break-words font-medium">{order.value?.items.find(line => line.productId === item.productId)?.name || "Produto do recebimento"}</p><p>{item.quantity} {item.unit} · {money(item.amount)}</p></li>)}</ul>
    {receipt.data.payableId ? <Link className={purchaseLink} href={`/financeiro/contas-pagar/${receipt.data.payableId}`}>Consultar conta a pagar</Link> : <p>Este recebimento não originou título com valor positivo.</p>}
    <CommercialReturn kind="purchase" id={receipt.data.id} tenantId={receipt.tenantId} etag={order.etag} reversed={Boolean(receipt.data.reversalId)} canManage={Boolean(order.value?.canEdit && order.value.tenantId === receipt.tenantId && access.value?.tenant.id === receipt.tenantId && ["inventory.stock.manage", "finance.payables.manage"].every(permission => access.value!.permissions.includes(permission)))} disabled={order.loading} onSuccess={reversed} onReload={() => { order.reload(); reload() }} />
  </>
}
