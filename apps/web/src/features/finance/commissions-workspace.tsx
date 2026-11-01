"use client"

import Link from "next/link"
import { useState } from "react"
import { PageHeader } from "@/components/page-header"
import { RequestError } from "@/components/session-recovery"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { decimalPattern, normalizeDecimal } from "@/lib/decimal-input"
import { useCommand, useResource } from "@/features/operations/use-operation"

type Balance = { sellerStaffId: string; sellerName: string; revision: number; openAmount: string; paidAmount: string }
type Listing = { tenantId: string; canEdit: boolean; data: Balance[]; total: number; totals: { openAmount: string; paidAmount: string } }
type Entry = { id: string; kind: "receipt" | "reversal" | "adjustment"; sellerName: string; orderId: string | null; receiptId: string | null; reversesEntryId: string | null; competence: string; paymentDue: string; amount: string; baseAmount: string; commissionRate: string | null; ipiRate: string | null; reason: string; paymentId: string | null }
type Payment = { id: string; amount: string; throughCompetence: string; occurredOn: string; reference: string }
type Book = { tenantId: string; canEdit: boolean; data: Balance; entries: Entry[]; payments: Payment[] }
type Terms = { tenantId: string; canEdit: boolean; data: { orderId: string; revision: number; status: "configured" | "not_required"; locked: boolean; sellerStaffId: string | null; sellerName: string | null; commissionRate: string | null; ipiRate: string | null; paymentDay: number | null } }
const linkClass = "font-medium text-primary underline underline-offset-4"
const selectClass = "block h-9 w-full min-w-0 rounded-lg border bg-background px-3 text-sm"
const money = (value: string) => `R$ ${value.replace(".", ",")}`
const origin = { receipt: "Recebimento", reversal: "Estorno", adjustment: "Ajuste manual" }

export function CommissionsWorkspace() {
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState("")
  const result = useResource<Listing>(`/api/erp/commissions?offset=${offset}&limit=25`)
  return <>
    <PageHeader eyebrow="Financeiro" title="Comissões" description="Comissões sobre recebimentos sem IPI. Os débitos são descontados quando sua competência está incluída no pagamento. Os pagamentos anteriores ficam preservados." />
    <section className="form-section min-w-0 space-y-5">
      {result.loading ? <p role="status">Carregando comissões…</p> : result.error ? <div role="alert"><RequestError message={result.error} status={result.status} /><Button variant="outline" onClick={result.reload}>Consultar comissões novamente</Button></div> : result.value && <>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2"><div className="rounded-xl border p-4"><p>Saldo em aberto</p><p className="text-xl font-semibold">{money(result.value.totals.openAmount)}</p></div><div className="rounded-xl border p-4"><p>Pagamentos declarados</p><p className="text-xl font-semibold">{money(result.value.totals.paidAmount)}</p></div></div>
        {!result.value.data.length ? <p>Nenhum vendedor cadastrado. Cadastre a equipe antes de configurar comissões.</p> : <ul className="grid min-w-0 gap-3 sm:grid-cols-2">{result.value.data.map(seller => <li key={seller.sellerStaffId} className="min-w-0 space-y-2 rounded-xl border p-4"><h2 className="break-words font-medium">{seller.sellerName}</h2><p>Em aberto: {money(seller.openAmount)}</p><p>Pago declarado: {money(seller.paidAmount)}</p><Button variant="outline" className="h-auto max-w-full whitespace-normal" onClick={() => setSelected(seller.sellerStaffId)}>Consultar comissões de {seller.sellerName}</Button></li>)}</ul>}
        <div className="flex flex-wrap justify-between gap-3"><Button variant="outline" disabled={!offset} onClick={() => setOffset(value => value - 25)}>Anterior</Button><Button variant="outline" disabled={offset + 25 >= result.value.total} onClick={() => setOffset(value => value + 25)}>Próxima</Button></div>
      </>}
    </section>
    {selected && <SellerCommissions key={`${result.value?.tenantId}:${selected}`} id={selected} onSaved={result.reload} />}
  </>
}

function SellerCommissions({ id, onSaved }: { id: string; onSaved: () => void }) {
  const result = useResource<Book>(`/api/erp/commissions/${id}`)
  const command = useCommand()
  const [action, setAction] = useState<"payments" | "adjustments">("payments")
  const [competence, setCompetence] = useState("")
  const [occurredOn, setOccurredOn] = useState("")
  const [reference, setReference] = useState("")
  const [amount, setAmount] = useState("")
  const [paymentDay, setPaymentDay] = useState("")
  const [notice, setNotice] = useState("")
  const frozen = command.busy || command.uncertain || command.stale
  function clear() { setCompetence(""); setOccurredOn(""); setReference(""); setAmount(""); setPaymentDay("") }
  const value = result.value
  return <section className="form-section mt-5 min-w-0 space-y-5" aria-label="Livro de comissões">
    {notice && <p role="status">{notice}</p>}
    {result.loading ? <p role="status">Carregando livro de comissões…</p> : result.error ? <div role="alert"><RequestError message={result.error} status={result.status} /><Button variant="outline" onClick={result.reload}>Consultar livro novamente</Button></div> : value && <>
      <h2 className="break-words text-lg font-semibold">Comissões de {value.data.sellerName}</h2>
      <p>Saldo em aberto: {money(value.data.openAmount)} · Pago declarado: {money(value.data.paidAmount)}</p>
      {!value.canEdit ? <p>Somente consulta.</p> : <form className="space-y-4" onSubmit={async event => {
        event.preventDefault(); setNotice("")
        const negative = amount.startsWith("-")
        const normalized = normalizeDecimal(negative ? amount.slice(1) : amount)
        if (action === "adjustments" && normalized === null) return
        const body = action === "payments" ? { throughCompetence: competence, occurredOn, reference: reference.trim() } : { amount: `${negative ? "-" : ""}${normalized}`, competence, paymentDay: Number(paymentDay), reason: reference.trim() }
        const response = await command.send<Book>(`/api/erp/commissions/${id}/${action}`, value.tenantId, body, result.etag)
        if (response) { setNotice(action === "payments" ? "Pagamento de comissão declarado." : "Ajuste de comissão registrado."); clear(); result.reload(); onSaved() }
      }}>
        <fieldset disabled={frozen} className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="min-w-0 space-y-2">Operação de comissão<select className={selectClass} value={action} onChange={event => { setAction(event.target.value as typeof action); clear(); command.reset() }}><option value="payments">Declarar pagamento</option><option value="adjustments">Lançar ajuste manual</option></select></label>
          <label className="min-w-0 space-y-2">{action === "payments" ? "Pagar competências até" : "Competência do ajuste"}<Input type="month" required min="1900-01" max="2100-12" value={competence} onChange={event => setCompetence(event.target.value)} /></label>
          {action === "payments" ? <label className="min-w-0 space-y-2">Data do pagamento da comissão<Input type="date" required value={occurredOn} onChange={event => setOccurredOn(event.target.value)} /></label> : <><label className="min-w-0 space-y-2">Valor do ajuste (negativo para débito)<Input inputMode="decimal" required pattern="-?[0-9]+([.,][0-9]{1,2})?" maxLength={16} value={amount} onChange={event => setAmount(event.target.value)} /></label><label className="min-w-0 space-y-2">Dia de pagamento do ajuste<Input type="number" min={1} max={28} required value={paymentDay} onChange={event => setPaymentDay(event.target.value)} /></label></>}
          <label className="min-w-0 space-y-2">{action === "payments" ? "Referência do pagamento da comissão" : "Motivo do ajuste de comissão"}<Input required minLength={3} maxLength={200} value={reference} onChange={event => setReference(event.target.value)} /></label>
        </fieldset>
        {action === "payments" && <p className="text-sm text-muted-foreground">O pagamento reúne os lançamentos em aberto até a competência selecionada. Os débitos são descontados quando sua competência está incluída no pagamento. O saldo líquido precisa ser positivo.</p>}
        {command.error && <p role="alert"><RequestError message={command.error} status={command.status} /></p>}
        {command.uncertain && <p role="status">Confirmação pendente. A repetição conserva os dados e a chave do comando.</p>}
        {command.stale && <Button type="button" variant="outline" onClick={() => { if (window.confirm("Descartar esta edição e carregar o livro atual?")) { command.reset(); clear(); result.reload(); onSaved() } }}>Recarregar livro de comissões</Button>}
        <Button type="submit" disabled={command.busy || command.stale || !result.etag} className="h-auto max-w-full whitespace-normal">{command.busy ? "Confirmando…" : command.uncertain ? "Repetir confirmação da comissão" : action === "payments" ? "Confirmar pagamento da comissão" : "Confirmar ajuste da comissão"}</Button>
      </form>}
      <h3 className="font-semibold">Histórico de comissões</h3>
      {!value.entries.length ? <p>Nenhuma comissão lançada.</p> : <ul className="space-y-3">{value.entries.map(entry => <li className="min-w-0 space-y-2 rounded-xl border p-4" key={entry.id}><p className="font-medium">{origin[entry.kind]} · {money(entry.amount)}</p><p>Competência: {entry.competence} · Vencimento: {entry.paymentDue}</p><p className="break-words">{entry.reason}</p><p>Vendedor registrado: {entry.sellerName}</p>{entry.commissionRate !== null && <p>Base sem IPI: {money(entry.baseAmount)} · Comissão: {entry.commissionRate.replace(".", ",")}% · IPI: {entry.ipiRate?.replace(".", ",")}%</p>}<p>{entry.paymentId ? "Incluído em pagamento declarado" : "Em aberto"}</p>{entry.orderId && <Link className={`${linkClass} break-words`} href={`/vendas/pedidos/${entry.orderId}`}>Consultar pedido de origem</Link>}{entry.reversesEntryId && <p className="break-all text-xs text-muted-foreground">Estorna comissão {entry.reversesEntryId}</p>}</li>)}</ul>}
      <h3 className="font-semibold">Histórico de pagamentos de comissão</h3>
      {!value.payments.length ? <p>Nenhum pagamento de comissão declarado.</p> : <ul className="space-y-3">{value.payments.map(payment => <li key={payment.id} className="min-w-0 space-y-2 rounded-xl border p-4"><p>{money(payment.amount)} · {payment.occurredOn}</p><p>Competências até {payment.throughCompetence}</p><p className="break-words">{payment.reference}</p></li>)}</ul>}
    </>}
  </section>
}

export function OrderCommissionTerms({ orderId, onSaved }: { orderId: string; onSaved: () => void }) {
  const result = useResource<Terms>(`/api/erp/orders/${orderId}/commission`)
  return <section className="form-section mt-5 min-w-0 space-y-4" aria-label="Comissão do pedido"><h2 className="font-semibold">Comissão do pedido</h2>
    {result.loading ? <p role="status">Carregando comissão do pedido…</p> : result.error ? <p role="alert"><RequestError message={result.error} status={result.status} /></p> : result.value && <CommissionTermsForm key={`${result.value.tenantId}:${result.etag}`} value={result.value} etag={result.etag} onSaved={() => { result.reload(); onSaved() }} />}
  </section>
}
function CommissionTermsForm({ value, etag, onSaved }: { value: Terms; etag: string; onSaved: () => void }) {
  const command = useCommand()
  const [sellerQuery, setSellerQuery] = useState("")
  const sellers = useResource<{ tenantId: string; data: { id: string; name: string }[]; total: number }>(`/api/erp/staff?role=seller&status=active&limit=100&q=${encodeURIComponent(sellerQuery)}`)
  const [seller, setSeller] = useState(value.data.sellerStaffId || "")
  const [commission, setCommission] = useState(value.data.commissionRate || "")
  const [ipi, setIpi] = useState(value.data.ipiRate || "")
  const [day, setDay] = useState(value.data.paymentDay?.toString() || "")
  const frozen = command.busy || command.uncertain || command.stale || !value.canEdit
  if (value.data.locked || !value.canEdit) return <>{value.data.status === "not_required" ? <p>Pedido sem comissão configurada.</p> : <><p>Vendedor: {value.data.sellerName}</p><p>Comissão: {value.data.commissionRate?.replace(".", ",")}% · IPI: {value.data.ipiRate?.replace(".", ",")}% · Pagamento: dia {value.data.paymentDay} do mês seguinte.</p></>}<p>As condições ficam preservadas após a confirmação do pedido.</p></>
  return <form className="space-y-4" onSubmit={async event => {
    event.preventDefault()
    const commissionRate = normalizeDecimal(commission, 4), ipiRate = normalizeDecimal(ipi, 4)
    if (commissionRate === null || ipiRate === null) return
    const response = await command.send<Terms>(`/api/erp/orders/${value.data.orderId}/commission`, value.tenantId, { sellerStaffId: seller, commissionRate, ipiRate, paymentDay: Number(day) }, etag, "PUT")
    if (response) onSaved()
  }}>
    {value.data.status === "not_required" && <p>Sem configuração, os recebimentos não geram comissão. Informe as condições acordadas antes de confirmar o pedido.</p>}
    {sellers.error && <p role="alert"><RequestError message={sellers.error} status={sellers.status} /></p>}
    <label className="block min-w-0 space-y-2">Buscar vendedor da comissão<Input disabled={frozen} maxLength={160} value={sellerQuery} onChange={event => setSellerQuery(event.target.value)} placeholder="Nome ou código" /></label>
    <fieldset disabled={frozen || sellers.loading || !!sellers.error || sellers.value?.tenantId !== value.tenantId} className="grid min-w-0 gap-4 sm:grid-cols-2">
      <label className="min-w-0 space-y-2">Vendedor da comissão<select required className={selectClass} value={seller} onChange={event => setSeller(event.target.value)}><option value="">Selecione um vendedor ativo</option>{value.data.sellerStaffId && !sellers.value?.data.some(candidate => candidate.id === value.data.sellerStaffId) && <option value={value.data.sellerStaffId}>{value.data.sellerName} (registrado no pedido)</option>}{sellers.value?.data.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
      <label className="min-w-0 space-y-2">Comissão percentual<Input required inputMode="decimal" pattern={decimalPattern(4)} value={commission} onChange={event => setCommission(event.target.value)} placeholder="Ex.: 5,0000" /></label>
      <label className="min-w-0 space-y-2">IPI percentual da comissão<Input required inputMode="decimal" pattern={decimalPattern(4)} value={ipi} onChange={event => setIpi(event.target.value)} placeholder="Ex.: 10,0000" /></label>
      <label className="min-w-0 space-y-2">Dia do pagamento da comissão<Input required type="number" min={1} max={28} value={day} onChange={event => setDay(event.target.value)} /></label>
    </fieldset>
    {sellers.value && sellers.value.total > 100 && <p>Mostrando os primeiros 100 resultados. Refine a busca pelo nome ou código do vendedor.</p>}
    {command.error && <p role="alert"><RequestError message={command.error} status={command.status} /></p>}
    {command.uncertain && <p role="status">Confirmação pendente. Repita para conferir a mesma configuração.</p>}
    {command.stale && <Button type="button" variant="outline" onClick={() => { if (window.confirm("Descartar a configuração em edição e carregar o pedido atual?")) onSaved() }}>Recarregar comissão do pedido</Button>}
    <Button type="submit" disabled={command.busy || command.stale || !etag || sellers.loading || !!sellers.error || sellers.value?.tenantId !== value.tenantId}>{command.uncertain ? "Repetir configuração da comissão" : "Salvar comissão do pedido"}</Button>
  </form>
}
