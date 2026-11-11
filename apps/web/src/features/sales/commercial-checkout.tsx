"use client"

import { useImperativeHandle, useState, type Ref } from "react"
import { GuardedLink } from "@/components/shell/navigation-guard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useResource } from "@/hooks/use-operation"
import { RequestError } from "@/components/feedback/session-recovery"
import { addPaymentDays, entryFromPercent, entryPercent, installmentPlan, paymentToday, type CheckoutInput, type PaymentMethod } from "./commercial-payment-model"
import { inputAmount, money, parseAmount } from "./negotiation-types"

type Row = { key: string; paymentMethodId: string; dueOn: string; amount: string }
export type CheckoutHandle = { read: () => CheckoutInput }
const selectClass = "h-9 min-h-9 w-full min-w-0 rounded-lg border bg-background px-2"
const textareaClass = "min-h-16 w-full rounded-lg border bg-background p-2"

function Method({ label, value, methods, onChange, disabled }: { label: string; value: string; methods: PaymentMethod[]; onChange: (value: string) => void; disabled?: boolean }) {
  return <label className="grid min-w-0 gap-1">{label}<select aria-label={label} className={selectClass} disabled={disabled} value={value} onChange={event => onChange(event.target.value)}><option value="">Escolha a forma</option>{methods.map(method => <option key={method.id} value={method.id}>{method.name}</option>)}</select></label>
}

type Customer = { tenantId: string; data: { personType: string; legalName: string; tradeName?: string | null; taxId: string; email?: string | null; phone?: string | null; addresses?: { street: string; number: string; complement?: string | null; district: string; city: string; state: string; postalCode: string; primary: boolean }[]; contacts?: { name: string; email?: string | null; phone?: string | null; primary: boolean }[] } }
function CustomerDetails({ id, tenantId }: { id: string; tenantId: string }) {
  const resource = useResource<Customer>(`/api/erp/parties/${id}`)
  const customer = resource.value?.tenantId === tenantId ? resource.value.data : null
  if (resource.loading) return <p role="status" className="text-xs">Conferindo cadastro do cliente…</p>
  if (!customer) return <div className="space-y-2 text-xs"><p role="status"><RequestError message={resource.error || "Não foi possível conferir o cadastro."} status={resource.status} /></p><Button type="button" variant="outline" onClick={resource.reload}>Atualizar cadastro</Button></div>
  const address = customer.addresses?.find(item => item.primary) || customer.addresses?.[0]
  const contact = customer.contacts?.find(item => item.primary) || customer.contacts?.[0]
  return <div className="space-y-2 rounded-lg border bg-muted/20 p-3 text-xs">
    <dl className="grid grid-cols-2 gap-2"><div className="col-span-2"><dt className="text-muted-foreground">{customer.personType === "juridica" ? "Razão social" : "Nome"}</dt><dd className="break-words font-medium">{customer.legalName}</dd></div>{[["CPF / CNPJ", customer.taxId], ["Nome fantasia", customer.tradeName], ["Responsável", contact?.name], ["Celular", contact?.phone || customer.phone], ["E-mail", contact?.email || customer.email]].filter(([, value]) => value).map(([label, value]) => <div className={label === "E-mail" ? "col-span-2" : "min-w-0"} key={label}><dt className="text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd></div>)}<div className="col-span-2"><dt className="text-muted-foreground">Endereço cadastrado</dt><dd className="break-words">{address ? [address.street, address.number, address.complement, address.district, `${address.city}/${address.state}`, address.postalCode].filter(Boolean).join(" · ") : "Complete o endereço no cadastro do cliente."}</dd></div></dl>
    <div className="flex flex-wrap gap-3"><GuardedLink className="text-primary underline" href={`/cadastros/clientes-fornecedores/${id}/editar`} target="_blank" rel="noopener noreferrer">Editar cadastro em outra aba</GuardedLink><button type="button" className="text-primary underline" onClick={resource.reload}>Atualizar cadastro</button></div>
  </div>
}

export function CommercialCheckout({ ref, customerId, tenantId, methods, totalCents, entryCents, entryRaw, onEntryChange, dueDate, onDueDateChange, onDirty, disabled }: { ref?: Ref<CheckoutHandle>; customerId?: string; tenantId: string; methods: PaymentMethod[]; totalCents: number | null; entryCents: number | null; entryRaw: string; onEntryChange: (raw: string) => void; dueDate: string; onDueDateChange: (date: string) => void; onDirty: () => void; disabled: boolean }) {
  const [entryMethod, setEntryMethod] = useState("")
  const [entryDate, setEntryDate] = useState("")
  const [balanceMethod, setBalanceMethod] = useState("")
  const [count, setCount] = useState("1")
  const [firstDays, setFirstDays] = useState("30")
  const [interval, setInterval] = useState("30")
  const [rows, setRows] = useState<Row[]>([])
  const [manufacturing, setManufacturing] = useState("")
  const [registrationDraft, setRegistration] = useState({ customerId, value: "" })
  const registration = registrationDraft.customerId === customerId ? registrationDraft.value : ""
  const [deliveryNotes, setDeliveryNotes] = useState("")
  const [paymentNotes, setPaymentNotes] = useState("")
  const [notes, setNotes] = useState("")
  const [error, setError] = useState("")
  const [invalidPercentForEntry, setInvalidPercentForEntry] = useState<string | null>(null)
  const paymentKey = `${totalCents}:${entryCents}`
  const balance = totalCents !== null && entryCents !== null ? totalCents - entryCents : null
  const rowsTotal = rows.reduce((sum, row) => sum + (parseAmount(row.amount) ?? 0), 0)
  function firstDate(date: string) {
    onDueDateChange(date)
    setRows(current => current.map((row, index) => index === 0 ? { ...row, dueOn: date } : row))
  }
  useImperativeHandle(ref, () => ({ read() {
    if (totalCents === null || entryCents === null || balance === null || balance < 0) throw Error("Simule a negociação para conferir a entrada e o saldo.")
    if (invalidPercentForEntry === paymentKey) throw Error("Confira o percentual da entrada antes de criar o pedido.")
    const hasMethod = (id: string) => methods.some(method => method.id === id)
    if (entryCents > 0 && !hasMethod(entryMethod)) throw Error("Escolha a forma de pagamento da entrada.")
    if (entryDate) addPaymentDays(entryDate, 0)
    if (rows.length > 120 || rowsTotal !== balance) throw Error("Gere ou ajuste as parcelas: a soma deve corresponder ao saldo da negociação.")
    const installments = rows.map(row => {
      const amountCents = parseAmount(row.amount)
      if (!hasMethod(row.paymentMethodId) || amountCents === null || amountCents <= 0) throw Error("Confira a forma e o valor de cada parcela.")
      addPaymentDays(row.dueOn, 0)
      return { paymentMethodId: row.paymentMethodId, dueOn: row.dueOn, amountCents }
    })
    const manufacturingDays = manufacturing.trim() ? Number(manufacturing) : null
    if (manufacturingDays !== null && (!/^\d{1,4}$/.test(manufacturing) || manufacturingDays > 3650)) throw Error("Informe um prazo de fabricação entre 0 e 3650 dias.")
    return { entry: { paymentMethodId: entryCents ? entryMethod : null, dueOn: entryCents && entryDate ? entryDate : null }, installments, stateRegistration: registration.trim() || null, manufacturingDays, deliveryNotes, paymentNotes, notes }
  } }))
  function generate() {
    onDirty()
    setError("")
    try {
      if (balance === null || balance < 0) throw Error("Simule a venda antes de gerar as parcelas.")
      if (!/^\d{1,3}$/.test(count) || !/^\d{1,4}$/.test(interval) || !/^\d{1,4}$/.test(firstDays)) throw Error("Confira quantidade, primeiro prazo e intervalo das parcelas.")
      const first = dueDate || addPaymentDays(entryDate || paymentToday(), Number(firstDays))
      const generated = installmentPlan(balance, Number(count), first, Number(interval), balanceMethod)
      setRows(generated.map(row => ({ key: crypto.randomUUID(), ...row, amount: inputAmount(row.amountCents) })))
      onDueDateChange(generated[0]?.dueOn || entryDate || paymentToday())
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Confira as condições do pagamento.") }
  }
  return <div className="space-y-4" onClickCapture={event => { if (event.target instanceof Element && event.target.closest("button")) onDirty() }}>
    {customerId && <CustomerDetails key={customerId} id={customerId} tenantId={tenantId} />}
    <fieldset disabled={disabled} className="min-w-0 space-y-3" onChange={onDirty}>
      <div className="grid min-w-0 grid-cols-2 gap-2"><label className="grid min-w-0 gap-1">Inscrição estadual do cliente<Input maxLength={40} value={registration} placeholder="Número ou ISENTO" onChange={event => setRegistration({ customerId, value: event.target.value })} /></label><label className="grid min-w-0 gap-1">Prazo de fabricação (dias)<Input inputMode="numeric" maxLength={4} value={manufacturing} onChange={event => setManufacturing(event.target.value)} /></label></div>
      <p className="text-xs text-muted-foreground">O prazo de fabricação é contado após o recebimento da entrada. A condição de contribuinte é conferida nas condições comerciais.</p>
      <label className="grid min-w-0 gap-1">Observações da entrega<textarea aria-label="Observações da entrega" className={textareaClass} rows={2} maxLength={2000} value={deliveryNotes} onChange={event => setDeliveryNotes(event.target.value)} /></label>
      <section className="min-w-0 space-y-3 border-t pt-3" aria-label="Forma de pagamento negociada">
        <h3 className="font-semibold">Forma de pagamento</h3>
        {!methods.length && <p role="status" className="text-sm">Cadastre uma forma de pagamento para concluir as condições. <GuardedLink className="text-primary underline" href="/cadastros/formas-pagamento" target="_blank" rel="noopener noreferrer">Consultar cadastro</GuardedLink></p>}
        <div className="grid grid-cols-2 gap-2"><label className="grid min-w-0 gap-1">Entrada (R$)<Input inputMode="decimal" value={entryRaw} placeholder={entryCents === null ? "Simule primeiro" : inputAmount(entryCents)} onChange={event => onEntryChange(event.target.value)} disabled={totalCents === null} /></label><label className="grid min-w-0 gap-1">Entrada (%)<Input key={paymentKey} inputMode="decimal" defaultValue={entryCents !== null && totalCents !== null ? entryPercent(entryCents, totalCents) : ""} disabled={totalCents === null} onBlur={event => { setInvalidPercentForEntry(null); setError(""); if (totalCents === null || entryCents !== null && event.target.value.trim().replace(".", ",") === entryPercent(entryCents, totalCents)) return; const amount = entryFromPercent(totalCents, event.target.value); if (amount === null) { setInvalidPercentForEntry(paymentKey); setError("A entrada deve estar entre 0% e 100%.") } else if (amount !== entryCents) { setError(""); onEntryChange(inputAmount(amount)) } }} /></label></div>
        <div className="grid grid-cols-2 gap-2"><Method label="Forma da entrada" value={entryMethod} methods={methods} onChange={setEntryMethod} disabled={entryCents === 0} /><label className="grid min-w-0 gap-1">Data da entrada<Input type="date" value={entryDate} onChange={event => setEntryDate(event.target.value)} /></label></div>
        <p className="text-xs text-muted-foreground">Data da entrada vazia: vencimento na confirmação do pedido. Previsto não significa recebido.</p>
        <h4 className="font-medium">Saldo{balance !== null && balance >= 0 ? ` · ${money(balance)}` : " · simule para conferir"}</h4>
        <Method label="Forma do saldo" value={balanceMethod} methods={methods} onChange={setBalanceMethod} />
        <div className="grid grid-cols-3 gap-2"><label className="grid min-w-0 gap-1">Parcelas<Input inputMode="numeric" maxLength={3} value={count} onChange={event => setCount(event.target.value)} /></label><label className="grid min-w-0 gap-1">Primeira em (dias)<Input inputMode="numeric" maxLength={4} value={firstDays} onChange={event => { setFirstDays(event.target.value); onDueDateChange("") }} /></label><label className="grid min-w-0 gap-1">Intervalo (dias)<Input inputMode="numeric" maxLength={4} value={interval} onChange={event => setInterval(event.target.value)} /></label></div>
        <label className="grid min-w-0 gap-1">Vencimento da conta a receber<Input type="date" value={dueDate} onChange={event => firstDate(event.target.value)} /></label>
        <p className="text-xs text-muted-foreground">Primeiro vencimento do saldo. Ajuste cada parcela após gerar; os valores precisam somar o saldo.</p>
        <Button type="button" variant="outline" disabled={balance === null} onClick={generate}>Gerar parcelas</Button>
        {rows.length > 0 && <ol className="space-y-2" aria-label="Parcelas negociadas">{rows.map((row, index) => <li key={row.key} className="min-w-0 space-y-2 rounded-lg border p-2"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">Parcela {index + 1} de {rows.length}</span><Button type="button" variant="ghost" className="h-8 min-h-8 px-2" aria-label={`Remover parcela ${index + 1}`} onClick={() => { const remaining = rows.filter(item => item.key !== row.key); setRows(remaining); setCount(String(Math.max(1, remaining.length))); if (index === 0) onDueDateChange(remaining[0]?.dueOn || "") }}>Remover</Button></div><div className="grid grid-cols-2 gap-2"><label className="grid min-w-0 gap-1">Vencimento da parcela {index + 1}<Input type="date" value={row.dueOn} onChange={event => { setRows(rows.map(item => item.key === row.key ? { ...item, dueOn: event.target.value } : item)); if (index === 0) onDueDateChange(event.target.value) }} /></label><label className="grid min-w-0 gap-1">Valor da parcela {index + 1} (R$)<Input inputMode="decimal" value={row.amount} onChange={event => setRows(rows.map(item => item.key === row.key ? { ...item, amount: event.target.value } : item))} /></label></div><Method label={`Forma da parcela ${index + 1}`} value={row.paymentMethodId} methods={methods} onChange={value => setRows(rows.map(item => item.key === row.key ? { ...item, paymentMethodId: value } : item))} /></li>)}</ol>}
        {rows.length > 0 && <p role="status" className="text-xs">Parcelas: {money(rowsTotal)}{balance !== null ? ` · Saldo: ${money(balance)}${rowsTotal === balance ? " · Soma conferida" : " · Ajuste os valores"}` : ""}</p>}
        <Button type="button" variant="outline" disabled={rows.length >= 120 || !balanceMethod} onClick={() => { const next = { key: crypto.randomUUID(), paymentMethodId: balanceMethod, dueOn: rows.at(-1)?.dueOn || dueDate || paymentToday(), amount: "0,00" }; setRows([...rows, next]); setCount(String(rows.length + 1)) }}>Adicionar parcela</Button>
        <label className="grid min-w-0 gap-1">Observações do pagamento<textarea aria-label="Observações do pagamento" className={textareaClass} rows={2} maxLength={2000} value={paymentNotes} onChange={event => setPaymentNotes(event.target.value)} /></label>
      </section>
      <label className="grid min-w-0 gap-1">Observações do pedido<textarea aria-label="Observações do pedido" className={textareaClass} rows={2} maxLength={10000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
    </fieldset>
    {error && <p role="alert" className="text-sm">{error}</p>}
  </div>
}
