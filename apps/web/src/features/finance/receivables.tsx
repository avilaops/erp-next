"use client"

import type { Schema } from "@/lib/api/types"

import { useSuggestedPaymentMethod } from "@/features/finance/settings/use-suggested-payment-method"
import { commercialMoney } from "@/features/sales/order-presentation"

import { decimalPattern, normalizeDecimal } from "@/lib/decimal-input"

import { RequestError } from "@/components/feedback/session-recovery"

import Link from "next/link"
import { useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/workspace/data-table"
import { Pagination } from "@/components/workspace/pagination"
import { useCommand, useResource } from "../../hooks/use-operation"

type Receivable = Schema<"Receivable">
type Detail = Schema<"ReceivableSnapshot">
type Listing = Schema<"ReceivableList">
type FinancialAccounts = { data: { id: string; code: string; name: string }[] }
const linkClass = "font-medium text-primary underline underline-offset-4"
const selectClass = "block h-9 w-full min-w-0 rounded-lg border bg-background px-3 text-sm"

function situation(account: Receivable) {
  if (account.status === "cancelled") return "Cancelado"
  return account.status === "paid" ? "Recebimento declarado" : account.receivedAmount === "0.00" ? "Em aberto" : "Recebimento parcial declarado"
}

export function Receivables({ id }: { id?: string }) {
  return id ? <ReceivableDetail key={id} id={id} /> : <ReceivableList />
}
function ReceivableList() {
  const [offset, setOffset] = useState(0)
  const result = useResource<Listing>(`/api/erp/receivables?offset=${offset}&limit=25`)
  const total = result.value?.total || 0
  return <>
    <PageHeader eyebrow="Financeiro" title="Contas a receber" description="Consulte vencimentos, saldos e recebimentos declarados dos pedidos de venda." actions={<Link className={buttonVariants({ variant: "outline" })} href="/vendas/pedidos">Consultar pedidos</Link>} />
    <section className="min-w-0 space-y-3" aria-label="Consulta de contas a receber">
      {result.loading ? <p role="status">Carregando contas…</p> : result.error ? <div role="alert"><p><RequestError message={result.error} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button></div> : <>
        <p className="text-sm text-muted-foreground">{total} conta(s) a receber</p>
        {result.value?.data.length ? <div className="workspace-list-scroll" role="region" aria-label="Lista de contas a receber" tabIndex={0}>
          <DataTable aria-label="Contas a receber" className="table-fixed md:table-auto">
            <thead><tr><th scope="col" className="w-[65%] md:w-auto">Cliente</th><th scope="col" className="hidden md:table-cell">Vencimento</th><th scope="col" className="hidden md:table-cell">Valor</th><th scope="col" className="text-right">Saldo restante</th><th scope="col" className="hidden md:table-cell">Situação</th><th scope="col" className="hidden md:table-cell">Pedido</th></tr></thead>
            <tbody>{result.value.data.map((account: Receivable) => <tr key={account.id}>
              <th scope="row" className="align-top"><Link className={`${linkClass} block [overflow-wrap:anywhere]`} href={`/financeiro/contas-receber/${account.id}`}>Conta de {account.customerName}</Link><div className="mt-1 space-y-0.5 text-xs font-normal text-muted-foreground md:hidden"><p>Vencimento: {account.dueDate.split("-").reverse().join("/")}</p><p>Valor: {commercialMoney(account.amount)}</p><p>{situation(account)}</p></div></th>
              <td className="hidden whitespace-nowrap md:table-cell">{account.dueDate.split("-").reverse().join("/")}</td>
              <td className="hidden whitespace-nowrap md:table-cell">{commercialMoney(account.amount)}</td>
              <td className="text-right align-top font-medium [overflow-wrap:anywhere] md:whitespace-nowrap">{commercialMoney(account.outstandingAmount)}</td>
              <td className="hidden md:table-cell">{situation(account)}</td>
              <td className="hidden max-w-44 break-all text-xs text-muted-foreground md:table-cell">{account.orderId}</td>
            </tr>)}</tbody>
          </DataTable>
        </div> : <div className="form-section space-y-2">
          <h2>Nenhuma conta a receber encontrada</h2>
          <p className="text-sm text-muted-foreground">Consulte os pedidos de venda para conferir a origem dos títulos e as condições de pagamento.</p>
        </div>}
        {(total > 25 || offset > 0) && <Pagination offset={offset} pageSize={25} total={total} onOffsetChange={setOffset} />}
      </>}
    </section>
  </>
}
function ReceivableDetail({ id }: { id: string }) {
  const result = useResource<Detail>(`/api/erp/receivables/${id}`)
  const command = useCommand()
  const { method, setMethod, loading: methodLoading, error: methodError } = useSuggestedPaymentMethod()
  const financialAccounts = useResource<FinancialAccounts>("/api/erp/financial-accounts?status=active&limit=100")
  const [reference, setReference] = useState("")
  const [occurredOn, setOccurredOn] = useState("")
  const [amount, setAmount] = useState("")
  const [notice, setNotice] = useState("")
  const [selectedPaymentId, setSelectedPaymentId] = useState("")
  const [financialAccountId, setFinancialAccountId] = useState("")
  const value = result.value
  const paid = value?.data.status === "paid"
  const cancelled = value?.data.status === "cancelled"
  const reversalId = selectedPaymentId || (paid ? value?.data.paymentId : null)
  const reversing = Boolean(reversalId)
  const frozen = methodLoading || command.busy || command.uncertain || command.stale
  const activeReceipts = cancelled ? [] : value?.payments.filter(payment => payment.kind === "receipt" && !value.payments.some(other => other.reversesId === payment.id)) || []
  function clearForm() { setReference(""); setAmount(""); setOccurredOn(""); setSelectedPaymentId(""); setFinancialAccountId("") }
  return <><PageHeader eyebrow="Financeiro" title="Conta a receber" description="Recebimentos manuais, parciais ou integrais. Estornar um recebimento recompõe o saldo e preserva o histórico. Não movimenta uma conta bancária." /><Link className={linkClass} href="/financeiro/contas-receber">Voltar às contas</Link>
    <section className="form-section mt-5 min-w-0 space-y-5">
      {notice && <p role="status">{notice}</p>}
      {methodError && <p role="status">Sugestão indisponível. Confira o meio declarado antes de confirmar.</p>}
      {result.loading ? <p role="status">Carregando conta…</p> : result.error ? <p role="alert"><RequestError message={result.error} status={result.status} /></p> : value && <>
        <h2 className="break-words font-semibold">{value.data.customerName}</h2><p>Valor: R$ {value.data.amount.replace(".", ",")}</p><p>Recebido declarado: R$ {value.data.receivedAmount.replace(".", ",")}</p><p>Saldo restante: R$ {value.data.outstandingAmount.replace(".", ",")}</p><p>Situação: {situation(value.data)}</p><p>Vencimento: {value.data.dueDate}</p><p className="break-all text-sm text-muted-foreground">Conta {id} · Revisão {value.data.revision}</p><Link className={linkClass} href={`/vendas/pedidos/${value.data.orderId}`}>Consultar pedido de origem</Link>
        {!value.canEdit ? <p>Somente consulta.</p> : cancelled ? <p>Título cancelado. O histórico foi preservado.</p> : <form className="space-y-4" onSubmit={async event => {
          event.preventDefault(); setNotice("")
          const normalizedAmount = normalizeDecimal(amount)
          if (!reversing && normalizedAmount === null) return
          const body = reversing ? { paymentId: reversalId, reason: reference, occurredOn } : { amount: normalizedAmount, method, reference, occurredOn, financialAccountId: financialAccountId || null }
          const response = await command.send<Detail>(`/api/erp/receivables/${id}/${reversing ? "reverse-payment" : "payments"}`, value.tenantId, body, result.etag)
          if (response) { setNotice("Registro confirmado no servidor."); clearForm(); result.reload() }
        }}>
          <h3 className="font-medium">{reversing ? "Estornar recebimento" : "Registrar recebimento"}</h3>
          <fieldset disabled={frozen} className="grid min-w-0 gap-4 sm:grid-cols-2">
             {reversing ? <label className="min-w-0 space-y-2">Recebimento a estornar<select className={selectClass} value={reversalId || ""} onChange={event => setSelectedPaymentId(event.target.value)}>{activeReceipts.map(payment => <option value={payment.id} key={payment.id}>R$ {payment.amount.replace(".", ",")} · {payment.reference} · {payment.id}</option>)}</select></label> : <><label className="min-w-0 space-y-2">Valor declarado (vírgula ou ponto)<Input required inputMode="decimal" pattern={decimalPattern(2)} maxLength={15} value={amount} onChange={event => setAmount(event.target.value)} /></label><label className="min-w-0 space-y-2">Meio declarado<select className={selectClass} value={method} onChange={event => setMethod(event.target.value)}><option value="bank_transfer">Transferência</option><option value="cash">Dinheiro</option><option value="card">Cartão</option><option value="other">Outro</option></select></label><label className="min-w-0 space-y-2 sm:col-span-2">Conta financeira (opcional)<select className={selectClass} value={financialAccountId} onChange={event => setFinancialAccountId(event.target.value)}><option value="">Sem vínculo bancário</option>{financialAccounts.value?.data.map((account: FinancialAccounts["data"][number]) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select><span className="text-xs text-muted-foreground">Informar uma conta cria o lançamento correspondente no ledger.</span></label></>}
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

