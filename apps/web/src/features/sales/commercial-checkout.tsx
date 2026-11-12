"use client"

import { useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react"
import { GuardedLink } from "@/components/shell/navigation-guard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useResource } from "@/hooks/use-operation"
import { RequestError } from "@/components/feedback/session-recovery"
import { addPaymentDays, entryFromPercent, entryPercent, installmentPlan, nextInstallmentDate, paymentToday, type CheckoutInput, type PaymentMethod } from "./commercial-payment-model"
import { inputAmount, money, parseAmount } from "./negotiation-types"
import { paymentPlanReadiness, validateCheckout, type CheckoutRow } from "./commercial-payment-mobile-model"
import { OrderDateField } from "./order-date-field"
import type { OrderIssue } from "./order-progress"
import "./order-payment-mobile.css"

type Row = CheckoutRow
const rowSignature = (rows: Row[]) => JSON.stringify(rows.map(row => [row.paymentMethodId, row.dueOn, row.amount]))
export type CheckoutHandle = { read: () => CheckoutInput; focus: (field: string) => void }
const selectClass = "h-9 min-h-9 w-full min-w-0 rounded-lg border bg-background px-2"
const textareaClass = "min-h-16 w-full rounded-lg border bg-background p-2"

type FieldValidation = { "data-checkout-field": string; "aria-invalid"?: boolean; "aria-describedby"?: string }
function Method({ label, value, methods, onChange, disabled, validation, orderClassName, error }: { label: string; value: string; methods: PaymentMethod[]; onChange: (value: string) => void; disabled?: boolean; validation?: FieldValidation; orderClassName?: string; error?: ReactNode }) {
  return <label className={`grid min-w-0 gap-1 ${orderClassName || ""}`}>{label}<select aria-label={label} className={selectClass} disabled={disabled} value={value} onChange={event => onChange(event.target.value)} {...validation}><option value="">Escolha a forma</option>{methods.map(method => <option key={method.id} value={method.id}>{method.name}</option>)}</select>{error}</label>
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

export function CommercialCheckout({ ref, customerId, tenantId, methods, totalCents, entryCents, entryRaw, onEntryChange, dueDate, onDueDateChange, onDirty, disabled, renderOrder, freightField, deliveryMethodNote, onProgressChange }: { ref?: Ref<CheckoutHandle>; customerId?: string; tenantId: string; methods: PaymentMethod[]; totalCents: number | null; entryCents: number | null; entryRaw: string; onEntryChange: (raw: string) => void; dueDate: string; onDueDateChange: (date: string) => void; onDirty: () => void; disabled: boolean; renderOrder?: (parts: { payment: ReactNode; delivery: ReactNode }) => ReactNode; freightField?: ReactNode; deliveryMethodNote?: string; onProgressChange?: (issues: OrderIssue[]) => void }) {
  const form = useRef<HTMLDivElement>(null)
  const issueId = useId()
  const [issue, setIssue] = useState<{ field: string; message: string; focus?: boolean } | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [entryMethod, setEntryMethod] = useState("")
  const [entryDate, setEntryDate] = useState("")
  const [balanceMethod, setBalanceMethod] = useState("")
  const [count, setCount] = useState("1")
  const [firstDays, setFirstDays] = useState("30")
  const [interval, setInterval] = useState("30")
  const [rows, setRows] = useState<Row[]>([])
  const [generatedSignature, setGeneratedSignature] = useState(rowSignature([]))
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [optionalOpen, setOptionalOpen] = useState(false)
  const [manufacturing, setManufacturing] = useState("")
  const [manufacturingUnit, setManufacturingUnit] = useState(renderOrder ? "business" : "calendar")
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
  const validation = validateCheckout({ orderMode: !!renderOrder, methods, totalCents, entryCents, invalidPercent: invalidPercentForEntry === paymentKey, entryMethod, entryDate, balanceMethod, rows, manufacturing, manufacturingUnit, registration, deliveryNotes, deliveryMethodNote, paymentNotes, notes })
  const progressSignature = JSON.stringify(validation.issues)
  const progressCallback = useRef(onProgressChange)
  const reportedSignature = useRef<string | null>(null)
  useEffect(() => { progressCallback.current = onProgressChange }, [onProgressChange])
  useEffect(() => {
    if (reportedSignature.current === progressSignature) return
    reportedSignature.current = progressSignature
    progressCallback.current?.(validation.issues)
  }, [progressSignature, validation.issues])
  const today = paymentToday()
  const plan = paymentPlanReadiness({ balance, methods, method: balanceMethod, count, firstDays, interval, entryDate, dueDate, today, rows })
  useEffect(() => {
    if (!issue || issue.focus === false) return
    const frame = requestAnimationFrame(() => {
      const field = form.current?.querySelector<HTMLElement>(`[data-checkout-field="${issue.field}"]`)
      if (!field || field.matches(":disabled")) return
      for (let group = field.closest("details"); group; group = group.parentElement?.closest("details") || null) group.open = true
      field.focus({ preventScroll: true })
      field.scrollIntoView({ block: "center" })
    })
    return () => cancelAnimationFrame(frame)
  }, [issue])
  function fieldProps(field: string): FieldValidation {
    const invalid = (attempted || issue?.field === field) && validation.issues.some(item => item.field === `checkout.${field}`)
    return { "data-checkout-field": field, "aria-invalid": invalid || undefined, "aria-describedby": invalid ? `${issueId}-${field}` : undefined }
  }
  function fieldError(field: string) {
    const message = (attempted || issue?.field === field) && validation.issues.find(item => item.field === `checkout.${field}`)?.message
    return message ? <span id={`${issueId}-${field}`} className="order-payment-inline-error">{message}</span> : null
  }
  function fail(field: string, message: string): never {
    setAttempted(true)
    setIssue({ field, message })
    throw Error(message)
  }
  function clearPlanIssue() {
    setIssue(current => current && (current.field === "generate" || current.field === "balance-method" || /^(amount|date|method)-/.test(current.field)) ? null : current)
  }
  function firstDate(date: string) {
    onDueDateChange(date)
    setRows(current => current.map((row, index) => index === 0 ? { ...row, dueOn: date } : row))
  }
  useImperativeHandle(ref, () => ({ read() {
    const first = validation.issues[0]
    if (first) fail(first.field.replace(/^checkout\./, ""), first.message)
    return validation.value!
  }, focus(field) {
    const rawField = field.replace(/^checkout\./, "")
    setAttempted(true)
    setIssue({ field: rawField, message: validation.issues.find(item => item.field === `checkout.${rawField}`)?.message || "" })
  } }))
  function generate(confirmed = false) {
    if (disabled) return
    onDirty()
    setError("")
    try {
      if (balance === null || balance < 0) throw Error("Simule a venda antes de gerar as parcelas.")
      if (renderOrder && plan.generateReason) throw Error(plan.generateReason)
      if (!renderOrder && (!/^\d{1,3}$/.test(count) || !/^\d{1,4}$/.test(interval) || !/^\d{1,4}$/.test(firstDays))) throw Error("Confira quantidade, primeiro prazo e intervalo das parcelas.")
      const first = renderOrder ? plan.firstDate : dueDate || nextInstallmentDate(entryDate || paymentToday(), firstDays)
      const generated = renderOrder && balance === 0 ? [] : installmentPlan(balance, Number(count), first, renderOrder ? plan.intervalDays : Number(interval), balanceMethod)
      if (!confirmed && rows.length > 0 && rowSignature(rows) !== generatedSignature) { setReplaceOpen(true); return }
      const next = generated.map(row => ({ key: crypto.randomUUID(), ...row, amount: inputAmount(row.amountCents) }))
      setRows(next)
      clearPlanIssue()
      setGeneratedSignature(rowSignature(next))
      setReplaceOpen(false)
      onDueDateChange(generated[0]?.dueOn || entryDate || paymentToday())
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Confira as condições do pagamento.") }
  }
  function addInstallment() {
    if (disabled) return
    setError("")
    try {
      if (plan.addReason) throw Error(plan.addReason)
      const lastDate = rows.at(-1)?.dueOn
      const dueOn = lastDate ? nextInstallmentDate(lastDate, interval) : dueDate ? addPaymentDays(dueDate, 0) : nextInstallmentDate(entryDate || paymentToday(), firstDays)
      setRows([...rows, { key: crypto.randomUUID(), paymentMethodId: balanceMethod, dueOn, amount: "0,00", expanded: true }])
      clearPlanIssue()
      setCount(String(rows.length + 1))
      if (!rows.length) onDueDateChange(dueOn)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Confira o vencimento da parcela.") }
  }
  const manufacturingHint = <p className="text-xs text-muted-foreground">{entryCents === null ? renderOrder ? "Contado após o pagamento da entrada, quando houver." : "Simule para conferir a condição de entrada." : entryCents > 0 ? "O prazo de fabricação é contado após o recebimento da entrada." : "Pedido sem entrada: combine com o cliente o início da fabricação e registre nas observações da entrega."}</p>
  const manufacturingFields = <>
    {renderOrder ? <div className="order-field-grid"><div className="grid min-w-0 content-start gap-1"><label htmlFor={`${issueId}-manufacturing`}>Prazo de fabricação<span aria-hidden="true"> *</span></label><div className="order-manufacturing-control"><Input id={`${issueId}-manufacturing`} required {...fieldProps("manufacturing")} aria-label="Prazo de fabricação" inputMode="numeric" placeholder="Ex.: 45" maxLength={4} value={manufacturing} onChange={event => setManufacturing(event.target.value)} /><select aria-label="Contagem do prazo" className={selectClass} value={manufacturingUnit} onChange={event => setManufacturingUnit(event.target.value)}><option value="business">Dias úteis</option><option value="calendar">Dias corridos</option></select></div>{fieldError("manufacturing")}{manufacturingHint}</div>{freightField}</div> : <><label className="grid min-w-0 gap-1">Prazo de fabricação (dias)<Input {...fieldProps("manufacturing")} aria-label="Prazo de fabricação (dias)" inputMode="numeric" maxLength={4} value={manufacturing} onChange={event => setManufacturing(event.target.value)} />{fieldError("manufacturing")}</label>{manufacturingHint}</>}
    <label className="grid min-w-0 gap-1">Observações da entrega<textarea {...fieldProps("delivery-notes")} aria-label="Observações da entrega" className={textareaClass} rows={2} maxLength={2000} value={deliveryNotes} onChange={event => setDeliveryNotes(event.target.value)} />{fieldError("delivery-notes")}</label>
    <label className="grid min-w-0 gap-1">{renderOrder ? "Observações" : "Observações do pedido"}<textarea aria-label={renderOrder ? "Observações" : "Observações do pedido"} className={textareaClass} rows={2} maxLength={10000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
  </>
  const paymentFields = <>
    <fieldset disabled={disabled} className="min-w-0 space-y-3" onChange={() => { setIssue(null); onDirty() }}>
      {!renderOrder && <><label className="grid min-w-0 gap-1">Inscrição estadual do cliente<Input maxLength={40} value={registration} placeholder="Número ou ISENTO" onChange={event => setRegistration({ customerId, value: event.target.value })} /></label><p className="text-xs text-muted-foreground">A condição de contribuinte é conferida nas condições comerciais.</p></>}
      <section className={renderOrder ? "order-payment-grid min-w-0" : "min-w-0 space-y-3 border-t pt-3"} aria-label="Forma de pagamento negociada">
        {!renderOrder && <h3 className="font-semibold">Forma de pagamento</h3>}
        {!methods.length && <p role="status" className="text-sm">Cadastre uma forma de pagamento para concluir as condições. <GuardedLink className="text-primary underline" href="/cadastros/formas-pagamento" target="_blank" rel="noopener noreferrer">Consultar cadastro</GuardedLink></p>}
        <div className={renderOrder ? "order-entry-values" : "grid grid-cols-2 gap-2"}>
          <label className="grid min-w-0 gap-1">Entrada (R$)<Input {...fieldProps("entry")} aria-label="Entrada (R$)" inputMode="decimal" value={renderOrder && !entryRaw && entryCents !== null ? inputAmount(entryCents) : entryRaw} placeholder={entryCents === null ? "Use a política comercial" : inputAmount(entryCents)} onChange={event => onEntryChange(event.target.value)} />{fieldError("entry")}</label>
          <label className="grid min-w-0 gap-1">Entrada (%)
            {renderOrder && totalCents === null ? <span className="order-payment-pending">A calcular com os equipamentos</span> : <Input {...fieldProps("entry-percent")} aria-label="Entrada (%)" key={paymentKey} inputMode="decimal" defaultValue={entryCents !== null && totalCents !== null ? entryPercent(entryCents, totalCents) : ""} disabled={totalCents === null} onBlur={event => { setInvalidPercentForEntry(null); setError(""); setIssue(current => current?.field === "entry-percent" ? null : current); if (totalCents === null || entryCents !== null && event.target.value.trim().replace(".", ",") === entryPercent(entryCents, totalCents)) return; const amount = entryFromPercent(totalCents, event.target.value); if (amount === null) { setInvalidPercentForEntry(paymentKey); setIssue({ field: "entry-percent", message: "A entrada deve estar entre 0% e 100%.", focus: false }) } else if (amount !== entryCents) { setError(""); onEntryChange(inputAmount(amount)) } }} />}
            {fieldError("entry-percent")}
          </label>
        </div>
        {renderOrder && <p className="order-payment-full text-xs text-muted-foreground">{entryCents !== null && totalCents !== null ? `${entryRaw.trim() ? "Entrada negociada" : "Política comercial"}: ${money(entryCents)} (${entryPercent(entryCents, totalCents)}%). Altere o valor ou o percentual para negociar; deixe o valor vazio para usar a política.` : "Adicione equipamentos para calcular a entrada da política comercial. Você também pode informar um valor em reais."}</p>}
        {totalCents === null && !renderOrder && <p className="text-xs text-muted-foreground">Ajuste a entrada em reais ou deixe vazia para usar a política comercial. Simule para conferir o percentual e o saldo.</p>}
        {(!renderOrder || entryCents !== null && entryCents > 0) && <>
          <div className={renderOrder ? "order-entry-method-date" : "grid grid-cols-2 gap-2"}>
            <Method orderClassName={renderOrder ? "order-entry-method" : undefined} validation={fieldProps("entry-method")} error={fieldError("entry-method")} label="Forma da entrada" value={entryMethod} methods={methods} onChange={setEntryMethod} disabled={entryCents === 0} />
            {renderOrder ? <div className="grid min-w-0 content-start gap-1"><OrderDateField {...fieldProps("entry-date")} label="Vencimento da entrada" emptyLabel="Na confirmação do pedido" value={entryDate} onChange={event => setEntryDate(event.target.value)} />{fieldError("entry-date")}</div> : <label className="grid min-w-0 gap-1">Data da entrada<Input {...fieldProps("entry-date")} type="date" value={entryDate} onChange={event => setEntryDate(event.target.value)} />{fieldError("entry-date")}</label>}
          </div>
          <p className="order-payment-full text-xs text-muted-foreground">{renderOrder ? "Sem data informada, a entrada vence na confirmação do pedido. Previsto não significa recebido." : "Data da entrada vazia: vencimento na confirmação do pedido. Previsto não significa recebido."}</p>
        </>}
        <h4 className="font-medium">Saldo{balance !== null && balance >= 0 ? ` · ${money(balance)}` : renderOrder ? " · a calcular" : " · simule para conferir"}</h4>
        <Method orderClassName={renderOrder ? "order-balance-method" : undefined} validation={fieldProps("balance-method")} error={fieldError("balance-method")} label="Forma do saldo" value={balanceMethod} methods={methods} onChange={setBalanceMethod} />
        <div className={renderOrder ? "order-installment-setup" : "grid grid-cols-3 gap-2"}><label className="grid min-w-0 gap-1">Parcelas<Input inputMode="numeric" maxLength={3} value={count} onChange={event => setCount(event.target.value)} /></label><label className="grid min-w-0 gap-1">Primeira em (dias)<Input inputMode="numeric" maxLength={4} value={firstDays} onChange={event => { setFirstDays(event.target.value); onDueDateChange("") }} /></label>{(!renderOrder || Number(count) > 1) && <label className="grid min-w-0 gap-1">Intervalo (dias)<Input inputMode="numeric" maxLength={4} value={interval} onChange={event => setInterval(event.target.value)} /></label>}</div>
        {!renderOrder && <label className="grid min-w-0 gap-1">Vencimento da conta a receber<Input type="date" value={dueDate} onChange={event => firstDate(event.target.value)} /></label>}
        <p className="order-payment-full text-xs text-muted-foreground">{renderOrder ? `Base para o primeiro prazo: ${(entryDate || today).split("-").reverse().join("/")} (${entryDate ? "vencimento da entrada informado" : "hoje na geração"}). ${dueDate ? `Primeiro vencimento atual: ${dueDate.split("-").reverse().join("/")}; altere o primeiro prazo para recalcular. ` : plan.firstDate ? `Primeiro vencimento previsto: ${plan.firstDate.split("-").reverse().join("/")}. ` : ""}As datas geradas ficam registradas no pedido. ` : "Primeiro vencimento do saldo. "}Ajuste cada parcela após gerar; os valores precisam somar o saldo.</p>
        <div {...fieldProps("generate")} tabIndex={-1} className={renderOrder ? "order-payment-full order-payment-action" : "grid gap-1"}>
          <Button type="button" variant="outline" disabled={renderOrder ? !!plan.generateReason : balance === null || balance < 0} aria-describedby={renderOrder && plan.generateReason ? `${issueId}-generate-reason` : undefined} onClick={() => generate()}>{renderOrder && balance === 0 && rows.length ? "Limpar parcelas do saldo" : "Gerar parcelas"}</Button>
          {renderOrder && balance === 0 && rows.length > 0 && <p className="text-xs text-muted-foreground">A entrada cobre o total. Limpe as parcelas do saldo para conferir o plano.</p>}
          {renderOrder && plan.generateReason && <p id={`${issueId}-generate-reason`} className="text-xs text-muted-foreground">{plan.generateReason}</p>}
          {fieldError("generate")}
        </div>
        {rows.length > 0 && <ol className="space-y-2" aria-label="Parcelas negociadas">{rows.map((row, index) => <li key={row.key} className="min-w-0 rounded-lg border">
          <details open={index === 0 || row.expanded} className="min-w-0">
            <summary className="min-h-11 cursor-pointer rounded-lg p-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"><span className="font-medium">Parcela {index + 1} de {rows.length}</span><span className="mt-1 block pl-4 text-muted-foreground">{row.dueOn ? row.dueOn.split("-").reverse().join("/") : "Confira o vencimento"} · {parseAmount(row.amount) === null ? "Confira o valor" : money(parseAmount(row.amount)!)} · {methods.find(method => method.id === row.paymentMethodId)?.name || "Escolha a forma"}</span></summary>
            <div className="space-y-2 border-t p-2"><div className={renderOrder ? "order-payment-row-values" : "grid grid-cols-2 gap-2"}>
              <div className="grid min-w-0 content-start gap-1">{renderOrder ? <OrderDateField {...fieldProps(`date-${row.key}`)} label={`Vencimento da parcela ${index + 1}`} value={row.dueOn} onChange={event => { setRows(rows.map(item => item.key === row.key ? { ...item, dueOn: event.target.value } : item)); if (index === 0) onDueDateChange(event.target.value) }} /> : <label className="grid min-w-0 gap-1">Vencimento da parcela {index + 1}<Input {...fieldProps(`date-${row.key}`)} type="date" value={row.dueOn} onChange={event => { setRows(rows.map(item => item.key === row.key ? { ...item, dueOn: event.target.value } : item)); if (index === 0) onDueDateChange(event.target.value) }} /></label>}{fieldError(`date-${row.key}`)}</div>
              <label className="grid min-w-0 gap-1">Valor da parcela {index + 1} (R$)<Input {...fieldProps(`amount-${row.key}`)} aria-label={`Valor da parcela ${index + 1} (R$)`} inputMode="decimal" value={row.amount} onChange={event => setRows(rows.map(item => item.key === row.key ? { ...item, amount: event.target.value } : item))} />{fieldError(`amount-${row.key}`)}</label>
            </div><Method validation={fieldProps(`method-${row.key}`)} error={fieldError(`method-${row.key}`)} label={`Forma da parcela ${index + 1}`} value={row.paymentMethodId} methods={methods} onChange={value => setRows(rows.map(item => item.key === row.key ? { ...item, paymentMethodId: value } : item))} /><Button type="button" variant="ghost" className="h-11 min-h-11 px-2 sm:h-8 sm:min-h-8" aria-label={`Remover parcela ${index + 1}`} onClick={() => { const remaining = rows.filter(item => item.key !== row.key); setRows(remaining); clearPlanIssue(); setCount(String(Math.max(1, remaining.length))); if (index === 0) onDueDateChange(remaining[0]?.dueOn || "") }}>Remover parcela</Button></div>
          </details>
        </li>)}</ol>}
        {rows.length > 0 && <p role="status" className="text-xs">Parcelas: {money(rowsTotal)}{balance !== null ? ` · Saldo: ${money(balance)}${rowsTotal === balance ? " · Soma conferida" : renderOrder ? ` · ${rowsTotal < balance ? "Faltam" : "Excedem"} ${money(Math.abs(balance - rowsTotal))}; ajuste os valores` : " · Ajuste os valores"}` : " · Simule para conferir o saldo"}</p>}
        <div className={renderOrder ? "order-payment-full order-payment-action" : "grid gap-1"}>
          <Button type="button" variant="outline" disabled={renderOrder ? !!plan.addReason : rows.length >= 120 || !balanceMethod || balance === null || balance <= 0} aria-describedby={renderOrder && plan.addReason ? `${issueId}-add-reason` : undefined} onClick={addInstallment}>Adicionar parcela</Button>
          {renderOrder && plan.addReason && <p id={`${issueId}-add-reason`} className="text-xs text-muted-foreground">{plan.addReason}</p>}
        </div>
        {renderOrder && <label className="grid min-w-0 gap-1">Observações do pagamento<textarea aria-label="Observações do pagamento" className={textareaClass} rows={2} maxLength={2000} value={paymentNotes} onChange={event => setPaymentNotes(event.target.value)} /></label>}
      </section>
      {!renderOrder && <details open={optionalOpen} onToggle={event => setOptionalOpen(event.currentTarget.open)} className="min-w-0 rounded-lg border"><summary className="min-h-11 cursor-pointer rounded-lg p-3 font-medium focus-visible:outline-2 focus-visible:outline-ring">Entrega e observações<span className="mt-1 block pl-4 text-xs font-normal text-muted-foreground">{[manufacturing && `${manufacturing} dias`, deliveryNotes.trim() && "Entrega preenchida", paymentNotes.trim() && "Pagamento preenchido", notes.trim() && "Pedido preenchido"].filter(Boolean).join(" · ") || "Prazo de fabricação e informações opcionais"}</span></summary><div className="space-y-3 border-t p-3">{manufacturingFields}<label className="grid min-w-0 gap-1">Observações do pagamento<textarea aria-label="Observações do pagamento" className={textareaClass} rows={2} maxLength={2000} value={paymentNotes} onChange={event => setPaymentNotes(event.target.value)} /></label></div></details>}
    </fieldset>
  </>
  const feedback = <>
    {issue?.message && !renderOrder && <p id={issueId} role={issue.focus === false ? "alert" : undefined} className="text-sm text-destructive">{issue.message}</p>}
    {error && <p role="alert" className="text-sm">{error}</p>}
    <Dialog open={replaceOpen && !disabled} onOpenChange={setReplaceOpen}><DialogContent showCloseButton={false}><DialogHeader><DialogTitle>Substituir as parcelas editadas?</DialogTitle><DialogDescription>As alterações de valores, vencimentos e formas de pagamento serão substituídas por um novo plano com as condições atuais.</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" onClick={() => setReplaceOpen(false)}>Manter parcelas</Button><Button type="button" disabled={disabled} onClick={() => generate(true)}>Substituir parcelas</Button></DialogFooter></DialogContent></Dialog>
  </>
  if (renderOrder) return <div ref={form} onClickCapture={event => { if (event.target instanceof Element && event.target.closest("button")) onDirty() }}>{renderOrder({ payment: <div className="order-payment-fields">{paymentFields}{feedback}</div>, delivery: <fieldset disabled={disabled} className="min-w-0 space-y-3" onChange={() => { setIssue(null); onDirty() }}>{manufacturingFields}</fieldset> })}</div>
  return <div ref={form} className="space-y-4" onClickCapture={event => { if (event.target instanceof Element && event.target.closest("button")) onDirty() }}>
    {customerId && <CustomerDetails key={customerId} id={customerId} tenantId={tenantId} />}
    {paymentFields}
    {feedback}
  </div>
}
