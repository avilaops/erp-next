"use client"

import type { Schema } from "@/lib/api/types"

import { useSuggestedPaymentMethod } from "@/features/finance/settings/use-suggested-payment-method"
import { commercialMoney } from "@/features/sales/order-presentation"

import { decimalPattern, normalizeDecimal } from "@/lib/decimal-input"

import { RequestError } from "@/components/feedback/session-recovery"

import Link from "next/link"
import { useEffect, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/workspace/data-table"
import { Pagination } from "@/components/workspace/pagination"
import { useCommand, useResource } from "@/hooks/use-operation"
import { money, purchaseLink, purchaseSelect } from "./purchase-types"

type Account = Schema<"UnifiedPayable">
type Detail = Schema<"UnifiedPayableSnapshot">
type Listing = Schema<"UnifiedPayableList">
type FinancialAccounts = { data: { id: string; code: string; name: string }[] }
const situation = (account: Account) => account.status === "cancelled" ? "Cancelado" : account.status === "paid" ? "Pagamento integral declarado" : account.paidAmount === "0.00" ? "Em aberto" : "Pagamento parcial declarado"

export function Payables({ id }: { id?: string }) {
  return id ? <PayableDetail key={id} id={id} /> : <PayableList />
}

function PayableList() {
  const [offset, setOffset] = useState(0)
  const result = useResource<Listing>(`/api/erp/financial-payables?offset=${offset}&limit=25`)
  const total = result.value?.total || 0
  return <>
    <PageHeader eyebrow="Financeiro" title="Contas a pagar" description="Consulte vencimentos, saldos e pagamentos declarados das obrigações da empresa." actions={<Link className={buttonVariants({ variant: "outline" })} href="/compras/pedidos">Consultar compras</Link>} />
    <section className="min-w-0 space-y-3" aria-label="Consulta de contas a pagar">
      {result.loading ? <p role="status">Carregando contas a pagar…</p> : result.error ? <div role="alert"><p><RequestError message={result.error} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button></div> : <>
        <p className="text-sm text-muted-foreground">{total} conta(s) a pagar</p>
        {result.value?.data.length ? <div className="workspace-list-scroll" role="region" aria-label="Lista de contas a pagar" tabIndex={0}>
          <DataTable aria-label="Contas a pagar" className="table-fixed md:table-auto">
            <thead><tr><th scope="col" className="w-[65%] md:w-auto">Favorecido</th><th scope="col" className="hidden md:table-cell">Vencimento</th><th scope="col" className="hidden md:table-cell">Valor</th><th scope="col" className="text-right">Saldo restante</th><th scope="col" className="hidden md:table-cell">Situação</th></tr></thead>
            <tbody>{result.value.data.map((account: Account) => <tr key={account.id}>
              <th scope="row" className="align-top"><Link className={`${purchaseLink} block [overflow-wrap:anywhere]`} href={`/financeiro/contas-pagar/${account.id}`}>Conta de {account.supplierName}</Link><div className="mt-1 space-y-0.5 text-xs font-normal text-muted-foreground md:hidden"><p>Vencimento: {account.dueDate.split("-").reverse().join("/")}</p><p>Valor: {commercialMoney(account.amount)}</p><p>{situation(account)}</p></div></th>
              <td className="hidden whitespace-nowrap md:table-cell">{account.dueDate.split("-").reverse().join("/")}</td>
              <td className="hidden whitespace-nowrap md:table-cell">{commercialMoney(account.amount)}</td>
              <td className="text-right align-top font-medium [overflow-wrap:anywhere] md:whitespace-nowrap">{commercialMoney(account.outstandingAmount)}</td>
              <td className="hidden md:table-cell">{situation(account)}</td>
            </tr>)}</tbody>
          </DataTable>
        </div> : <div className="form-section space-y-2"><h2>Nenhuma conta a pagar encontrada</h2><p className="text-sm text-muted-foreground">Consulte as compras e os pagamentos de funcionários para conferir a origem das obrigações.</p></div>}
        {(total > 25 || offset > 0) && <Pagination offset={offset} pageSize={25} total={total} onOffsetChange={setOffset} />}
      </>}
    </section>
  </>
}

function PayableDetail({ id }: { id: string }) {
  const result = useResource<Detail>(`/api/erp/financial-payables/${id}`)
  if (result.loading) return <><PageHeader eyebrow="Financeiro" title={"Conta a pagar"} description="Consulte a obrigação e os pagamentos declarados." /><p role="status">Carregando conta a pagar…</p></>
  if (result.error || !result.value) return <><PageHeader eyebrow="Financeiro" title={"Conta a pagar"} description="Consulte a obrigação e os pagamentos declarados." /><Link className={purchaseLink} href="/financeiro/contas-pagar">Voltar à lista</Link><section className="form-section space-y-3"><p role="alert"><RequestError message={result.error || "Conta indisponível"} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button></section></>
  return <PayableForm key={result.etag} value={result.value} etag={result.etag} reload={result.reload} />
}

function PayableForm({ value, etag, reload }: { value: Detail; etag: string; reload: () => void }) {
  const command = useCommand()
  const { method, setMethod, loading: methodLoading, error: methodError } = useSuggestedPaymentMethod()
  const financialAccounts = useResource<FinancialAccounts>("/api/erp/financial-accounts?status=active&limit=100")
  const [reference, setReference] = useState("")
  const [occurredOn, setOccurredOn] = useState("")
  const [amount, setAmount] = useState("")
  const [paymentId, setPaymentId] = useState("")
  const [financialAccountId, setFinancialAccountId] = useState("")
  const frozen = methodLoading || command.busy || command.uncertain || command.stale
  const dirty = Boolean(reference || occurredOn || amount || paymentId)
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty || command.uncertain) event.preventDefault() }
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent)
  }, [dirty, command.uncertain])
  const activePayments = value.data.status === "cancelled" ? [] : value.payments.filter(payment => payment.kind === "payment" && !value.payments.some(other => other.reversesId === payment.id))
  const paid = value.data.status === "paid"
  const cancelled = value.data.status === "cancelled"
  const reversing = Boolean(paymentId)
  return <><PageHeader eyebrow="Financeiro" title="Conta a pagar" description="Pagamentos declarados e estornos mantêm o histórico. Nenhuma transferência bancária é executada por esta tela." />
    <Link className={purchaseLink} href="/financeiro/contas-pagar" onClick={event => { if ((dirty || command.uncertain) && !window.confirm("Sair sem confirmar o registro financeiro em edição?")) event.preventDefault() }}>Voltar às contas a pagar</Link>
    <section className="form-section mt-5 min-w-0 space-y-5">
      <h2 className="break-words font-semibold">{value.data.supplierName}</h2><p>Valor: {money(value.data.amount)}</p><p>Pago declarado: {money(value.data.paidAmount)}</p><p>Saldo restante: {money(value.data.outstandingAmount)}</p><p>Situação: {situation(value.data)}</p><p>Vencimento: {value.data.dueDate} · Revisão {value.data.revision}</p>
      {!dirty && (value.data.staffId ? <Link className={purchaseLink} href={`/cadastros/funcionarios/${value.data.staffId}`}>Consultar funcionário de origem</Link> : <Link className={purchaseLink} href={`/compras/recebimentos/${value.data.receiptId}`}>Consultar recebimento de origem</Link>)}
      {methodError && <p role="status">Sugestão indisponível. Confira o meio declarado antes de confirmar.</p>}
      {!value.canEdit ? <p>Somente consulta.</p> : cancelled ? <p>Título cancelado. O histórico foi preservado.</p> : (!paid || reversing) && <form className="min-w-0 space-y-4" onSubmit={async event => {
        event.preventDefault()
        if (!command.uncertain && !window.confirm(reversing ? "Registrar o estorno deste pagamento declarado? O estoque e o recebimento da compra serão preservados." : "Registrar este pagamento manual no ERP? Nenhum dinheiro será transferido.")) return
        const normalizedAmount = normalizeDecimal(amount)
        if (!reversing && normalizedAmount === null) return
        const body = reversing ? { paymentId, reason: reference, occurredOn } : { amount: normalizedAmount, method, reference, occurredOn, financialAccountId: financialAccountId || null }
        const response = await command.send<Detail>(`/api/erp/financial-payables/${value.data.id}/${reversing ? "reverse-payment" : "payments"}`, value.tenantId, body, etag)
        if (response) { setReference(""); setOccurredOn(""); setAmount(""); setPaymentId(""); setFinancialAccountId(""); reload() }
      }}>
        <h3 className="font-semibold">{reversing ? "Estornar pagamento declarado" : "Registrar pagamento declarado"}</h3>
        <fieldset disabled={frozen} className="grid min-w-0 gap-4 sm:grid-cols-2">
          {reversing ? <label className="min-w-0 space-y-2">Pagamento a estornar<select className={purchaseSelect} value={paymentId} onChange={event => setPaymentId(event.target.value)}>{activePayments.map(payment => <option value={payment.id} key={payment.id}>{money(payment.amount)} · {payment.reference} · {payment.occurredOn}</option>)}</select></label> : <>
            <label className="min-w-0 space-y-2">Valor do pagamento<Input required inputMode="decimal" placeholder="0,00" pattern={decimalPattern(2)} maxLength={15} value={amount} onChange={event => setAmount(event.target.value)} /></label>
            <label className="min-w-0 space-y-2">Meio declarado<select className={purchaseSelect} value={method} onChange={event => setMethod(event.target.value)}><option value="bank_transfer">Transferência</option><option value="cash">Dinheiro</option><option value="card">Cartão</option><option value="other">Outro</option></select></label>
          </>}
            <label className="min-w-0 space-y-2">{reversing ? "Data do estorno" : "Data do pagamento"}<Input required type="date" value={occurredOn} onChange={event => setOccurredOn(event.target.value)} /></label>
            {!reversing && <label className="min-w-0 space-y-2 sm:col-span-2">Conta financeira (opcional)<select className={purchaseSelect} value={financialAccountId} onChange={event => setFinancialAccountId(event.target.value)}><option value="">Sem vínculo bancário</option>{financialAccounts.value?.data.map((account: FinancialAccounts["data"][number]) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select><span className="text-xs text-muted-foreground">Informar uma conta cria o lançamento correspondente no ledger.</span></label>}
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

