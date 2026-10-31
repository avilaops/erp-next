"use client"

import { useSuggestedPaymentMethod } from "@/features/financial-settings/use-suggested-payment-method"

import { decimalPattern, normalizeDecimal } from "@/lib/decimal-input"

import { RequestError } from "@/components/session-recovery"

import Link from "next/link"
import { useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCommand, useResource } from "./use-operation"

type Receivable = { id: string; orderId: string; customerName: string; dueDate: string; amount: string; receivedAmount: string; outstandingAmount: string; status: string; revision: number; paymentId: string | null }
type Payment = { id: string; kind: string; amount: string; method: string; reference: string; occurredOn: string; reversesId: string | null }
type Detail = { tenantId: string; canEdit: boolean; data: Receivable; payments: Payment[] }
type Listing = { tenantId: string; canEdit: boolean; data: Receivable[]; total: number }
const linkClass = "font-medium text-primary underline underline-offset-4"
const selectClass = "block h-9 w-full min-w-0 rounded-lg border bg-background px-3 text-sm"

function situation(account: Receivable) {
  return account.status === "paid" ? "Recebimento declarado" : account.receivedAmount === "0.00" ? "Em aberto" : "Recebimento parcial declarado"
}

export function Receivables({ id }: { id?: string }) {
  return id ? <ReceivableDetail key={id} id={id} /> : <ReceivableList />
}
function ReceivableList() {
  const [offset, setOffset] = useState(0)
  const result = useResource<Listing>(`/api/erp/receivables?offset=${offset}&limit=25`)
  return <><PageHeader eyebrow="Financeiro" title="Contas a receber" description="Títulos de pedidos concluídos. Os recebimentos são declarações manuais, sem confirmação bancária automática." />
    <section className="form-section min-w-0 space-y-4"><Link className={linkClass} href="/vendas/pedidos">Consultar pedidos</Link>
      {result.loading ? <p role="status">Carregando contas…</p> : result.error ? <div role="alert"><p><RequestError message={result.error} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button></div> : <>
        <p>{result.value?.total || 0} conta(s)</p>
        <ul className="grid min-w-0 gap-3 sm:grid-cols-2">{result.value?.data.map(account => <li key={account.id} className="min-w-0 space-y-2 rounded-xl border p-4"><Link className={`${linkClass} break-words`} href={`/financeiro/contas-receber/${account.id}`}>Conta de {account.customerName}</Link><p>R$ {account.amount.replace(".", ",")} · {situation(account)}</p><p>Saldo restante: R$ {account.outstandingAmount.replace(".", ",")}</p><p>Vencimento: {account.dueDate}</p><p className="break-all text-xs text-muted-foreground">Pedido {account.orderId}</p></li>)}</ul>
        <div className="flex flex-wrap justify-between gap-3"><Button variant="outline" disabled={!offset} onClick={() => setOffset(value => value - 25)}>Anterior</Button><Button variant="outline" disabled={offset + 25 >= (result.value?.total || 0)} onClick={() => setOffset(value => value + 25)}>Próxima</Button></div>
      </>}
    </section>
  </>
}
function ReceivableDetail({ id }: { id: string }) {
  const result = useResource<Detail>(`/api/erp/receivables/${id}`)
  const command = useCommand()
  const { method, setMethod, loading: methodLoading, error: methodError } = useSuggestedPaymentMethod()
  const [reference, setReference] = useState("")
  const [occurredOn, setOccurredOn] = useState("")
  const [amount, setAmount] = useState("")
  const [notice, setNotice] = useState("")
  const [selectedPaymentId, setSelectedPaymentId] = useState("")
  const value = result.value
  const paid = value?.data.status === "paid"
  const reversalId = selectedPaymentId || (paid ? value?.data.paymentId : null)
  const reversing = Boolean(reversalId)
  const frozen = methodLoading || command.busy || command.uncertain || command.stale
  const activeReceipts = value?.payments.filter(payment => payment.kind === "receipt" && !value.payments.some(other => other.reversesId === payment.id)) || []
  function clearForm() { setReference(""); setAmount(""); setOccurredOn(""); setSelectedPaymentId("") }
  return <><PageHeader eyebrow="Financeiro" title="Conta a receber" description="Recebimentos manuais, parciais ou integrais. Estornar um recebimento recompõe o saldo e preserva o histórico. Não movimenta uma conta bancária." /><Link className={linkClass} href="/financeiro/contas-receber">Voltar às contas</Link>
    <section className="form-section mt-5 min-w-0 space-y-5">
      {notice && <p role="status">{notice}</p>}
      {methodError && <p role="status">Sugestão indisponível. Confira o meio declarado antes de confirmar.</p>}
      {result.loading ? <p role="status">Carregando conta…</p> : result.error ? <p role="alert"><RequestError message={result.error} status={result.status} /></p> : value && <>
        <h2 className="break-words font-semibold">{value.data.customerName}</h2><p>Valor: R$ {value.data.amount.replace(".", ",")}</p><p>Recebido declarado: R$ {value.data.receivedAmount.replace(".", ",")}</p><p>Saldo restante: R$ {value.data.outstandingAmount.replace(".", ",")}</p><p>Situação: {situation(value.data)}</p><p>Vencimento: {value.data.dueDate}</p><p className="break-all text-sm text-muted-foreground">Conta {id} · Revisão {value.data.revision}</p><Link className={linkClass} href={`/vendas/pedidos/${value.data.orderId}`}>Consultar pedido de origem</Link>
        {!value.canEdit ? <p>Somente consulta.</p> : <form className="space-y-4" onSubmit={async event => {
          event.preventDefault(); setNotice("")
          const normalizedAmount = normalizeDecimal(amount)
          if (!reversing && normalizedAmount === null) return
          const body = reversing ? { paymentId: reversalId, reason: reference, occurredOn } : { amount: normalizedAmount, method, reference, occurredOn }
          const response = await command.send<Detail>(`/api/erp/receivables/${id}/${reversing ? "reverse-payment" : "payments"}`, value.tenantId, body, result.etag)
          if (response) { setNotice("Registro confirmado no servidor."); clearForm(); result.reload() }
        }}>
          <h3 className="font-medium">{reversing ? "Estornar recebimento" : "Registrar recebimento"}</h3>
          <fieldset disabled={frozen} className="grid min-w-0 gap-4 sm:grid-cols-2">
            {reversing ? <label className="min-w-0 space-y-2">Recebimento a estornar<select className={selectClass} value={reversalId || ""} onChange={event => setSelectedPaymentId(event.target.value)}>{activeReceipts.map(payment => <option value={payment.id} key={payment.id}>R$ {payment.amount.replace(".", ",")} · {payment.reference} · {payment.id}</option>)}</select></label> : <><label className="min-w-0 space-y-2">Valor declarado (vírgula ou ponto)<Input required inputMode="decimal" pattern={decimalPattern(2)} maxLength={15} value={amount} onChange={event => setAmount(event.target.value)} /></label><label className="min-w-0 space-y-2">Meio declarado<select className={selectClass} value={method} onChange={event => setMethod(event.target.value)}><option value="bank_transfer">Transferência</option><option value="cash">Dinheiro</option><option value="card">Cartão</option><option value="other">Outro</option></select></label></>}
            <label className="min-w-0 space-y-2">{reversing ? "Data do estorno" : "Data do recebimento"}<Input required type="date" value={occurredOn} onChange={event => setOccurredOn(event.target.value)} /></label>
            <label className="min-w-0 space-y-2">{reversing ? "Motivo do estorno" : "Referência do recebimento"}<Input required minLength={3} maxLength={200} value={reference} onChange={event => setReference(event.target.value)} /></label>
          </fieldset>
          {command.error && <p role="alert"><RequestError message={command.error} status={command.status} /></p>}
          {command.uncertain && <p role="status">Confirmação pendente. A repetição usa o mesmo comando.</p>}
          {command.stale && <Button type="button" variant="outline" onClick={() => {
            if (window.confirm("Descartar o registro em edição e carregar a conta atual do servidor?")) { command.reset(); clearForm(); result.reload() }
          }}>Recarregar conta</Button>}
          <Button className="h-auto max-w-full whitespace-normal" type="submit" disabled={command.busy || command.stale || !result.etag}>{command.busy ? "Confirmando…" : command.uncertain ? "Repetir confirmação financeira" : reversing ? "Confirmar estorno do recebimento" : "Confirmar recebimento declarado"}</Button>
          {reversing && !paid && <Button type="button" variant="outline" disabled={frozen} onClick={() => { clearForm(); command.reset() }}>Voltar ao recebimento</Button>}
        </form>}
        <h3 className="font-medium">Histórico de recebimentos</h3>
        {!value.payments.length ? <p>Nenhum recebimento registrado.</p> : <ul className="space-y-3">{value.payments.map(payment => <li key={payment.id} className="min-w-0 space-y-2 rounded-xl border p-4"><p>{payment.kind === "receipt" ? "Recebimento declarado" : "Estorno"} · R$ {payment.amount.replace(".", ",")} · {payment.occurredOn}</p><p className="break-words">{payment.reference}</p><p className="break-all text-xs text-muted-foreground">ID {payment.id}{payment.reversesId ? ` · Estorna ${payment.reversesId}` : ""}</p>{value.canEdit && activeReceipts.some(active => active.id === payment.id) && <Button variant="outline" aria-label={`Estornar recebimento ${payment.id}`} disabled={frozen} onClick={() => { clearForm(); setSelectedPaymentId(payment.id); command.reset() }}>Estornar este recebimento</Button>}</li>)}</ul>}
      </>}
    </section>
  </>
}
