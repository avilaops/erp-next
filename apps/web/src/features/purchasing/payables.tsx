"use client"

import { decimalPattern, normalizeDecimal } from "@/lib/decimal-input"

import { RequestError } from "@/components/session-recovery"

import Link from "next/link"
import { useEffect, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCommand, useResource } from "@/features/operations/use-operation"
import { money, purchaseLink, purchaseSelect } from "./purchase-types"

type Account = { id: string; receiptId: string; supplierName: string; dueDate: string; amount: string; paidAmount: string; outstandingAmount: string; status: string; revision: number }
type Payment = { id: string; kind: string; amount: string; method: string; reference: string; occurredOn: string; reversesId: string | null }
type Detail = { tenantId: string; canEdit: boolean; data: Account; payments: Payment[] }
type Listing = { tenantId: string; canEdit: boolean; data: Account[]; total: number }
const situation = (account: Account) => account.status === "paid" ? "Pagamento integral declarado" : account.paidAmount === "0.00" ? "Em aberto" : "Pagamento parcial declarado"

export function Payables({ id }: { id?: string }) {
  return id ? <PayableDetail key={id} id={id} /> : <PayableList />
}

function PayableList() {
  const [offset, setOffset] = useState(0)
  const result = useResource<Listing>(`/api/erp/payables?offset=${offset}&limit=25`)
  return <><PageHeader eyebrow="Financeiro" title="Contas a pagar" description="Obrigações geradas pelos recebimentos de compras. O registro de pagamento é manual e não envia dinheiro nem confirma liquidação bancária." />
    <section className="form-section min-w-0 space-y-4"><Link className={purchaseLink} href="/compras/pedidos">Consultar compras</Link>
      {result.loading ? <p role="status">Carregando contas a pagar…</p> : result.error ? <div role="alert"><p><RequestError message={result.error} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button></div> : <>
        <p>{result.value?.total || 0} conta(s) a pagar</p>{!result.value?.data.length && <p>Nenhuma conta a pagar originada por recebimento de compra neste módulo.</p>}
        <ul className="grid min-w-0 gap-3 sm:grid-cols-2">{result.value?.data.map(account => <li className="min-w-0 space-y-2 rounded-xl border p-4" key={account.id}><Link className={`${purchaseLink} break-words`} href={`/financeiro/contas-pagar/${account.id}`}>Conta de {account.supplierName}</Link><p>{situation(account)}</p><p>Valor: {money(account.amount)} · Saldo: {money(account.outstandingAmount)}</p><p>Vencimento: {account.dueDate}</p></li>)}</ul>
        <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="outline" disabled={!offset} onClick={() => setOffset(value => value - 25)}>Anterior</Button><span>Página {Math.floor(offset / 25) + 1}</span><Button variant="outline" disabled={offset + 25 >= (result.value?.total || 0)} onClick={() => setOffset(value => value + 25)}>Próxima</Button></div>
      </>}
    </section>
  </>
}

function PayableDetail({ id }: { id: string }) {
  const result = useResource<Detail>(`/api/erp/payables/${id}`)
  if (result.loading) return <p role="status">Carregando conta a pagar…</p>
  if (result.error || !result.value) return <section className="form-section space-y-3"><p role="alert"><RequestError message={result.error || "Conta indisponível"} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button></section>
  return <PayableForm key={result.etag} value={result.value} etag={result.etag} reload={result.reload} />
}

function PayableForm({ value, etag, reload }: { value: Detail; etag: string; reload: () => void }) {
  const command = useCommand()
  const [method, setMethod] = useState("bank_transfer")
  const [reference, setReference] = useState("")
  const [occurredOn, setOccurredOn] = useState("")
  const [amount, setAmount] = useState("")
  const [paymentId, setPaymentId] = useState("")
  const frozen = command.busy || command.uncertain || command.stale
  const dirty = Boolean(reference || occurredOn || amount || paymentId)
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty || command.uncertain) event.preventDefault() }
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent)
  }, [dirty, command.uncertain])
  const activePayments = value.payments.filter(payment => payment.kind === "payment" && !value.payments.some(other => other.reversesId === payment.id))
  const paid = value.data.status === "paid"
  const reversing = Boolean(paymentId)
  return <><PageHeader eyebrow="Financeiro" title="Conta a pagar" description="Pagamentos declarados e estornos mantêm o histórico. Nenhuma transferência bancária é executada por esta tela." />
    <Link className={purchaseLink} href="/financeiro/contas-pagar" onClick={event => { if ((dirty || command.uncertain) && !window.confirm("Sair sem confirmar o registro financeiro em edição?")) event.preventDefault() }}>Voltar às contas a pagar</Link>
    <section className="form-section mt-5 min-w-0 space-y-5">
      <h2 className="break-words font-semibold">{value.data.supplierName}</h2><p>Valor: {money(value.data.amount)}</p><p>Pago declarado: {money(value.data.paidAmount)}</p><p>Saldo restante: {money(value.data.outstandingAmount)}</p><p>Situação: {situation(value.data)}</p><p>Vencimento: {value.data.dueDate} · Revisão {value.data.revision}</p>
      {!dirty && <Link className={purchaseLink} href={`/compras/recebimentos/${value.data.receiptId}`}>Consultar recebimento de origem</Link>}
      {!value.canEdit ? <p>Somente consulta.</p> : (!paid || reversing) && <form className="min-w-0 space-y-4" onSubmit={async event => {
        event.preventDefault()
        if (!command.uncertain && !window.confirm(reversing ? "Registrar o estorno deste pagamento declarado? O estoque e o recebimento da compra serão preservados." : "Registrar este pagamento manual no ERP? Nenhum dinheiro será transferido.")) return
        const normalizedAmount = normalizeDecimal(amount)
        if (!reversing && normalizedAmount === null) return
        const body = reversing ? { paymentId, reason: reference, occurredOn } : { amount: normalizedAmount, method, reference, occurredOn }
        const response = await command.send<Detail>(`/api/erp/payables/${value.data.id}/${reversing ? "reverse-payment" : "payments"}`, value.tenantId, body, etag)
        if (response) { setReference(""); setOccurredOn(""); setAmount(""); setPaymentId(""); reload() }
      }}>
        <h3 className="font-semibold">{reversing ? "Estornar pagamento declarado" : "Registrar pagamento declarado"}</h3>
        <fieldset disabled={frozen} className="grid min-w-0 gap-4 sm:grid-cols-2">
          {reversing ? <label className="min-w-0 space-y-2">Pagamento a estornar<select className={purchaseSelect} value={paymentId} onChange={event => setPaymentId(event.target.value)}>{activePayments.map(payment => <option value={payment.id} key={payment.id}>{money(payment.amount)} · {payment.reference} · {payment.occurredOn}</option>)}</select></label> : <>
            <label className="min-w-0 space-y-2">Valor do pagamento<Input required inputMode="decimal" placeholder="0,00" pattern={decimalPattern(2)} maxLength={15} value={amount} onChange={event => setAmount(event.target.value)} /></label>
            <label className="min-w-0 space-y-2">Meio declarado<select className={purchaseSelect} value={method} onChange={event => setMethod(event.target.value)}><option value="bank_transfer">Transferência</option><option value="cash">Dinheiro</option><option value="card">Cartão</option><option value="other">Outro</option></select></label>
          </>}
          <label className="min-w-0 space-y-2">{reversing ? "Data do estorno" : "Data do pagamento"}<Input required type="date" value={occurredOn} onChange={event => setOccurredOn(event.target.value)} /></label>
          <label className="min-w-0 space-y-2">{reversing ? "Motivo do estorno" : "Referência do pagamento"}<Input required minLength={3} maxLength={200} value={reference} onChange={event => setReference(event.target.value)} /></label>
        </fieldset>
        {command.error && <p role="alert"><RequestError message={command.error} status={command.status} /></p>}
        {command.uncertain && <p role="status">Confirmação pendente. A repetição confere o mesmo registro financeiro.</p>}
        {command.stale && <Button type="button" variant="outline" onClick={() => { if (window.confirm("Descartar sua edição e recarregar a conta atual?")) { command.reset(); reload() } }}>Recarregar conta a pagar</Button>}
        <Button className="h-auto max-w-full whitespace-normal" type="submit" disabled={command.busy || command.stale || !etag}>{command.busy ? "Confirmando…" : command.uncertain ? "Repetir confirmação financeira" : reversing ? "Confirmar estorno do pagamento" : "Confirmar pagamento declarado"}</Button>
        {reversing && !paid && <Button type="button" variant="outline" disabled={frozen} onClick={() => { setPaymentId(""); setReference(""); setOccurredOn(""); setAmount(""); command.reset() }}>Voltar ao pagamento</Button>}
      </form>}
      <h3 className="font-semibold">Histórico de pagamentos</h3>
      {!value.payments.length ? <p>Nenhum pagamento registrado.</p> : <ul className="space-y-3">{value.payments.map(payment => <li className="min-w-0 space-y-2 rounded-xl border p-4" key={payment.id}><p>{payment.kind === "payment" ? "Pagamento declarado" : "Estorno"} · {money(payment.amount)} · {payment.occurredOn}</p><p className="break-words">{payment.reference}</p>{payment.reversesId && <p className="text-sm text-muted-foreground">Estorno vinculado ao pagamento original.</p>}{value.canEdit && activePayments.some(active => active.id === payment.id) && <Button variant="outline" disabled={frozen} aria-label={`Estornar pagamento ${payment.reference}`} onClick={() => { setPaymentId(payment.id); setReference(""); setOccurredOn(""); setAmount(""); command.reset() }}>Estornar este pagamento</Button>}</li>)}</ul>}
    </section>
  </>
}
