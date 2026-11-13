"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import type { Schema } from "@/lib/api/types"
import { useCommand, useResource } from "@/hooks/use-operation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RequestError } from "@/components/feedback/session-recovery"
import { useNavigationGuard } from "@/components/shell/navigation-guard"
import { commercialMoney } from "@/features/sales/order-presentation"
import { decimalPattern, normalizeDecimal } from "@/lib/decimal-input"
import { SupportingDocuments, financeSelect, supportingDocument } from "./supporting-documents"
import { useProtectedReload } from "./use-protected-reload"
import { useSuggestedPaymentMethod } from "./settings/use-suggested-payment-method"

export type ReceiptSnapshot = Schema<"ReceivableSnapshot">
type Projection = { tenantId: string; orderId: string; orderStatus: string; orderAmount: string; titleAmount: string; receivedAmount: string; outstandingAmount: string; state: string; canEdit: boolean; receivables: ReceiptSnapshot[] }
type Method = { id: string; code: string; name: string; modality: string }
const states: Record<string, string> = { not_originated: "Títulos ainda não gerados", open: "Em aberto", partial: "Recebido parcialmente", paid: "Recebimento integral declarado", cancelled: "Pedido cancelado", inconsistent: "Títulos precisam de conciliação" }
export function installmentName(snapshot: ReceiptSnapshot) {
  const data = snapshot.data as ReceiptSnapshot["data"] & { installmentKind?: string; installmentNumber?: number }
  return data.installmentKind === "entry" ? "Entrada" : data.installmentKind === "balance" ? `Parcela ${data.installmentNumber}` : "Título do pedido"
}

export function ReceiptForm({ snapshot, etag, onSaved, onReload, onLockChange, disabled = false, amountLabel = "Valor recebido", reloadLabel = "Recarregar parcelas" }: { snapshot: ReceiptSnapshot; etag?: string; onSaved: () => void; onReload: () => void; onLockChange?: (locked: boolean) => void; disabled?: boolean; amountLabel?: string; reloadLabel?: string }) {
  const command = useCommand()
  const methods = useResource<{ data: Method[] }>("/api/erp/payment-methods?status=active&limit=100")
  const accounts = useResource<{ data: { id: string; code: string; name: string }[] }>("/api/erp/financial-accounts?status=active&limit=100")
  const [methodId, setMethodId] = useState("")
  const { method: coarse, setMethod: setCoarse, loading: suggestionLoading, error: suggestionError } = useSuggestedPaymentMethod()
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState("")
  const [reference, setReference] = useState("")
  const [account, setAccount] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState("")
  const [preparing, setPreparing] = useState(false)
  const [fileKey, setFileKey] = useState(0)
  const frozen = preparing || command.busy || command.stale || command.uncertain
  useEffect(() => { onLockChange?.(frozen) }, [frozen, onLockChange])
  useEffect(() => () => onLockChange?.(false), [onLockChange])
  useNavigationGuard(command.uncertain || preparing || command.busy ? "Há um recebimento aguardando confirmação. Sair pode impedir a conferência do mesmo comando. Deseja sair?" : null)
  const configured = methods.value?.data || []
  const selected = configured.find(m => m.id === methodId)
  const revision = etag || `"${snapshot.data.revision}"`
  return <form className="space-y-3" onSubmit={async event => {
    event.preventDefault(); if (disabled || preparing) return
    const value = normalizeDecimal(amount)
    if (!value || configured.length && !selected) return
    setError(""); onLockChange?.(true); setPreparing(true)
    try {
      const method = selected ? ["pix", "bank_transfer"].includes(selected.modality) ? "bank_transfer" : ["credit_card", "debit_card"].includes(selected.modality) ? "card" : selected.modality === "cash" ? "cash" : "other" : coarse
      const document = file ? await supportingDocument(file, reference, date) : undefined
      const saved = await command.send<ReceiptSnapshot>(`/api/erp/receivables/${snapshot.data.id}/payments`, snapshot.tenantId, { amount: value, method, paymentMethodId: selected?.id || null, reference, occurredOn: date, financialAccountId: account || null, ...(document ? { supportingDocument: document } : {}) }, revision, "POST", reply => reply.tenantId === snapshot.tenantId && reply.data.id === snapshot.data.id)
      if (saved) { setAmount(""); setReference(""); setDate(""); setFile(null); setFileKey(k => k + 1); onSaved() }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível ler o comprovante.") } finally { setPreparing(false) }
  }}>
    <h3 className="text-sm font-medium">Registrar recebimento</h3>
    {!configured.length && suggestionError && <p role="status" className="text-sm">Sugestão indisponível. Confira o meio declarado antes de confirmar.</p>}
    <fieldset disabled={disabled || frozen} className="grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="min-w-0 space-y-1">{amountLabel}<Input required inputMode="decimal" pattern={decimalPattern(2)} maxLength={15} value={amount} onChange={event => setAmount(event.target.value)} /></label>
      <label className="min-w-0 space-y-1">Data do recebimento<Input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label>
      {configured.length ? <label className="min-w-0 space-y-1">Forma de pagamento<select required className={financeSelect} value={methodId} onChange={event => setMethodId(event.target.value)}><option value="">Escolha a forma recebida</option>{configured.map(method => <option key={method.id} value={method.id}>{method.name}</option>)}</select></label> : <label className="min-w-0 space-y-1">Meio declarado<select className={financeSelect} value={coarse} onChange={event => setCoarse(event.target.value)}><option value="bank_transfer">Transferência</option><option value="cash">Dinheiro</option><option value="card">Cartão</option><option value="other">Outro</option></select>{methods.error && <span className="text-xs text-muted-foreground">Formas cadastradas indisponíveis. Confira o meio declarado.</span>}</label>}
      <label className="min-w-0 space-y-1">Referência do recebimento<Input required minLength={3} maxLength={200} value={reference} onChange={event => setReference(event.target.value)} /></label>
      <label className="min-w-0 space-y-1">Conta financeira (opcional)<select className={financeSelect} value={account} onChange={event => setAccount(event.target.value)}><option value="">Sem conta vinculada</option>{accounts.value?.data.map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select><span className="text-xs text-muted-foreground">A conta escolhida recebe o lançamento financeiro correspondente.</span></label>
      <label className="min-w-0 space-y-1">Arquivo do comprovante<Input key={fileKey} type="file" accept="application/pdf,image/png,image/jpeg" onChange={event => setFile(event.target.files?.[0] || null)} /><span className="text-xs text-muted-foreground">Opcional · PDF, PNG ou JPEG · até 10 MiB</span></label>
    </fieldset>
    {error && <p role="alert">{error}</p>}{command.error && <p role="alert"><RequestError message={command.error} status={command.status} /></p>}
    {command.uncertain && <p role="status">Confirmação pendente. A repetição usa o mesmo recebimento e comprovante.</p>}
    {command.stale && <Button variant="outline" type="button" disabled={disabled} onClick={() => { command.reset(); onReload() }}>{reloadLabel}</Button>}
    <p className="text-xs text-muted-foreground">Declara o recebimento ocorrido. Não realiza uma cobrança ou transferência bancária.</p>
    <Button type="submit" className="h-auto max-w-full whitespace-normal" disabled={disabled || preparing || command.busy || command.stale || methods.loading || !configured.length && suggestionLoading}>{command.uncertain ? "Repetir confirmação financeira" : preparing || command.busy ? "Confirmando…" : "Confirmar recebimento declarado"}</Button>
  </form>
}

export function OrderFinancePanel({ orderId, receivableId, allowReceipt = true, parentBusy = false, onLockChange }: { orderId: string; receivableId?: string; allowReceipt?: boolean; parentBusy?: boolean; onLockChange?: (locked: boolean) => void }) {
  const result = useResource<Projection>(`/api/erp/orders/${orderId}/finance`)
  const [selectedId, setSelectedId] = useState("")
  const [refresh, setRefresh] = useState(0)
  const boundary = useProtectedReload(() => { result.reload(); setRefresh(n => n + 1) })
  const { setPrimaryLocked, setSecondaryLocked, isLocked } = boundary
  const receiptLock = useCallback((locked: boolean) => { setPrimaryLocked(locked); onLockChange?.(isLocked()) }, [setPrimaryLocked, isLocked, onLockChange])
  const documentLock = useCallback((locked: boolean) => { setSecondaryLocked(locked); onLockChange?.(isLocked()) }, [setSecondaryLocked, isLocked, onLockChange])
  useEffect(() => () => onLockChange?.(false), [onLockChange])
  const candidate = result.value
  const value = candidate?.orderId === orderId && typeof candidate.tenantId === "string"
    && [candidate.orderAmount, candidate.titleAmount, candidate.receivedAmount, candidate.outstandingAmount].every(amount => typeof amount === "string")
    && Object.hasOwn(states, candidate.state) && Array.isArray(candidate.receivables)
    && candidate.receivables.every(t => t?.data?.orderId === orderId && Array.isArray(t.payments)) ? candidate : null
  const all = value?.receivables || []
  const scoped = receivableId ? all.filter(t => t.data.id === receivableId) : all
  const open = scoped.filter(t => t.data.status === "open" && t.canEdit)
  const selected = open.find(t => t.data.id === selectedId) || open[0]
  const payments = scoped.flatMap(t => t.payments.filter(p => p.kind === "receipt").map(p => ({ id: p.id, label: `${installmentName(t)} · ${commercialMoney(p.amount)} · ${p.reference}${t.payments.some(reversal => reversal.reversesId === p.id) ? " · estornado" : ""}` })))
  const reload = boundary.reload
  return <div className="min-w-0 space-y-5">
    <section aria-label="Financeiro do pedido" className="min-w-0 space-y-4 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Financeiro do pedido</h2><Button size="sm" variant="outline" disabled={parentBusy || boundary.locked || result.loading} onClick={reload}>Atualizar financeiro</Button></div>
      {result.loading && !value ? <p role="status">Consultando recebimentos…</p> : result.error || !value ? <p role="status">{result.status === 403 ? "Sem acesso ao financeiro deste pedido." : "Financeiro indisponível no momento. Os dados comerciais continuam disponíveis."}</p> : <>
        <p className="text-sm">{states[value.state] || "Situação financeira indisponível"}</p>
        <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">{[["Total do pedido", value.orderAmount, "order-total"], ["Recebido líquido", value.receivedAmount, "order-received"], ["Saldo em aberto", value.outstandingAmount, "order-outstanding"]].map(([label, amount, id]) => <div className="min-w-0" key={id}><dt className="text-xs text-muted-foreground">{label}</dt><dd data-testid={id} className="break-words font-semibold tabular-nums">{commercialMoney(amount)}</dd></div>)}</dl>
        {value.state === "not_originated" && <p className="text-sm">As condições negociadas ainda não geraram títulos. Nenhum recebimento foi confirmado.</p>}
        {value.state === "inconsistent" && <p role="status">Confira os títulos no financeiro antes de registrar novos recebimentos.</p>}
        {!receivableId && scoped.length > 0 && <ul className="space-y-3">{scoped.map(title => <li key={title.data.id} className="min-w-0 rounded-lg border p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><Link className="font-medium text-primary underline" href={`/financeiro/contas-receber/${title.data.id}`}>{installmentName(title)}</Link><span>{commercialMoney(title.data.amount)} · vencimento {title.data.dueDate}</span></div>
          <p>Recebido: {commercialMoney(title.data.receivedAmount)} · Saldo: {commercialMoney(title.data.outstandingAmount)}{title.data.status === "cancelled" ? " · Cancelado" : ""}</p>
          {title.payments.length > 0 && <ul className="mt-2 space-y-1 border-t pt-2">{title.payments.map(payment => {
            const historicalMethod = (payment as typeof payment & { paymentMethod?: { name: string } | null }).paymentMethod
            return <li key={payment.id} className="break-words">{payment.kind === "receipt" ? "Recebimento" : "Estorno"} · {commercialMoney(payment.amount)} · {payment.occurredOn} · {historicalMethod?.name ? `${historicalMethod.name} · ` : ""}{payment.reference}</li>
          })}</ul>}
        </li>)}</ul>}
        {!value.canEdit && <p className="text-sm">Somente consulta financeira.</p>}
        {allowReceipt && value.canEdit && !["cancelled", "inconsistent", "not_originated"].includes(value.state) && selected && <div className="space-y-3">
          <label className="block min-w-0 space-y-1 text-sm">Parcela para recebimento<select disabled={parentBusy || boundary.locked || result.loading} className={financeSelect} value={selected.data.id} onChange={event => setSelectedId(event.target.value)}>{open.map(t => <option key={t.data.id} value={t.data.id}>{installmentName(t)} · saldo {commercialMoney(t.data.outstandingAmount)}</option>)}</select></label>
          <ReceiptForm key={selected.data.id} snapshot={selected} onSaved={reload} onReload={reload} onLockChange={receiptLock} disabled={parentBusy || boundary.secondaryLocked || result.loading} />
        </div>}
      </>}
    </section>
    <SupportingDocuments orderId={orderId} payments={payments} paymentScope={receivableId ? payments.map(p => p.id) : undefined} refresh={refresh} onLockChange={documentLock} disabled={parentBusy || boundary.primaryLocked || result.loading} />
  </div>
}
