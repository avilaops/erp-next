import { addPaymentDays, nextInstallmentDate, type CheckoutInput, type PaymentMethod } from "./commercial-payment-model.ts"
import { parseAmount } from "./negotiation-types.ts"
import type { OrderIssue } from "./order-progress"

export type CheckoutRow = { key: string; paymentMethodId: string; dueOn: string; amount: string; expanded?: boolean }
type CheckoutDraft = {
  orderMode: boolean; methods: PaymentMethod[]; totalCents: number | null; entryCents: number | null
  invalidPercent: boolean; entryMethod: string; entryDate: string; balanceMethod: string; rows: CheckoutRow[]
  manufacturing: string; manufacturingUnit: string; registration: string; deliveryNotes: string
  deliveryMethodNote?: string; paymentNotes: string; notes: string
}

/** Read and progress reporting consume the same result; validation never changes the draft. */
export function validateCheckout(draft: CheckoutDraft): { issues: OrderIssue[]; value: CheckoutInput | null } {
  const issues: OrderIssue[] = []
  function issue(field: string, message: string, section: "payment" | "delivery" = "payment") {
    if (!issues.some(item => item.field === `checkout.${field}`)) issues.push({ field: `checkout.${field}`, section, message })
  }
  const hasMethod = (id: string) => draft.methods.some(method => method.id === id)
  const balance = draft.totalCents !== null && draft.entryCents !== null ? draft.totalCents - draft.entryCents : null
  if (balance === null || balance < 0) issue("entry", "Simule a negociação para conferir a entrada e o saldo.")
  if (draft.invalidPercent) issue("entry-percent", "Confira o percentual da entrada antes de criar o pedido.")
  if (draft.entryCents !== null && draft.entryCents > 0 && !hasMethod(draft.entryMethod)) issue("entry-method", "Escolha a forma de pagamento da entrada.")
  if (draft.entryDate && (!draft.orderMode || draft.entryCents !== null && draft.entryCents > 0)) {
    try { addPaymentDays(draft.entryDate, 0) } catch { issue("entry-date", "Informe uma data válida para a entrada.") }
  }
  if (draft.rows.length > 120) issue("generate", "O plano deve ter no máximo 120 parcelas.")
  if (!draft.rows.length && balance !== null && balance > 0) {
    if (draft.orderMode) {
      if (!hasMethod(draft.balanceMethod)) issue("balance-method", "Escolha a forma de pagamento do saldo.")
      issue("generate", "Gere as parcelas para distribuir o saldo da negociação.")
    } else issue(hasMethod(draft.balanceMethod) ? "generate" : "balance-method", "Escolha a forma do saldo e gere as parcelas antes de criar o pedido.")
  }
  const installments = draft.rows.map((row, index) => {
    const amountCents = parseAmount(row.amount)
    try { addPaymentDays(row.dueOn, 0) } catch { issue(`date-${row.key}`, `Informe um vencimento válido para a parcela ${index + 1}.`) }
    if (amountCents === null || amountCents <= 0) issue(`amount-${row.key}`, `Informe um valor maior que zero para a parcela ${index + 1}.`)
    if (!hasMethod(row.paymentMethodId)) issue(`method-${row.key}`, `Escolha a forma de pagamento da parcela ${index + 1}.`)
    return { paymentMethodId: row.paymentMethodId, dueOn: row.dueOn, amountCents: amountCents ?? 0 }
  })
  const rowsTotal = installments.reduce((sum, row) => sum + row.amountCents, 0)
  if (balance !== null && rowsTotal !== balance && draft.rows.length) issue(`amount-${draft.rows[0].key}`, "Gere ou ajuste as parcelas: a soma deve corresponder ao saldo da negociação.")
  const manufacturingDays = draft.manufacturing.trim() ? Number(draft.manufacturing) : null
  if (draft.orderMode && manufacturingDays === null) issue("manufacturing", "Informe o prazo de fabricação.", "delivery")
  if (manufacturingDays !== null && (!/^\d{1,4}$/.test(draft.manufacturing) || manufacturingDays > 3650)) issue("manufacturing", "Informe um prazo de fabricação entre 0 e 3650 dias.", "delivery")
  const recordedDelivery = draft.orderMode ? [
    draft.deliveryMethodNote?.trim(),
    manufacturingDays !== null ? `Prazo de fabricação: ${manufacturingDays} dias ${draft.manufacturingUnit === "business" ? "úteis" : "corridos"}. ${draft.entryCents !== null && draft.entryCents > 0 ? "Contado após o pagamento da entrada." : "Início conforme combinado com o cliente."}` : "",
    draft.deliveryNotes.trim(),
  ].filter(Boolean).join("\n") : draft.deliveryNotes
  if (recordedDelivery.length > 2000) issue("delivery-notes", "As observações da entrega, incluindo modalidade e prazo, devem ter até 2000 caracteres.", "delivery")
  if (issues.length) return { issues, value: null }
  return { issues, value: {
    entry: { paymentMethodId: draft.entryCents ? draft.entryMethod : null, dueOn: draft.entryCents && draft.entryDate ? draft.entryDate : null },
    installments, stateRegistration: draft.registration.trim() || null, manufacturingDays,
    deliveryNotes: recordedDelivery, paymentNotes: draft.paymentNotes, notes: draft.notes,
  } }
}

type PlanDraft = { balance: number | null; methods: PaymentMethod[]; method: string; count: string; firstDays: string; interval: string; entryDate: string; dueDate: string; today: string; rows: { dueOn: string }[] }
export function paymentPlanReadiness(draft: PlanDraft) {
  const reason = draft.balance === null || draft.balance < 0 ? "Simule a negociação para conferir o saldo." : draft.balance === 0 ? "O pagamento está integralmente na entrada; não há saldo para parcelar." : !draft.methods.some(method => method.id === draft.method) ? "Escolha a forma de pagamento do saldo." : ""
  if (draft.balance === 0 && draft.rows.length) return { generateReason: "", addReason: reason, firstDate: "", addDate: "", intervalDays: 0 }
  let generateReason = reason
  let addReason = reason
  let firstDate = ""
  let addDate = ""
  const intervalDays = draft.count === "1" ? 0 : Number(draft.interval)
  if (!generateReason) {
    if (!/^\d{1,3}$/.test(draft.count) || Number(draft.count) < 1 || Number(draft.count) > 120) generateReason = "Informe de 1 a 120 parcelas."
    else if (draft.balance! < Number(draft.count)) generateReason = "Cada parcela deve ter valor maior que zero."
    else if (Number(draft.count) > 1 && (!/^\d{1,4}$/.test(draft.interval) || intervalDays > 3650)) generateReason = "Informe um intervalo entre 0 e 3650 dias."
    else {
      try {
        firstDate = draft.dueDate ? addPaymentDays(draft.dueDate, 0) : nextInstallmentDate(draft.entryDate || draft.today, draft.firstDays)
        addPaymentDays(firstDate, (Number(draft.count) - 1) * intervalDays)
      } catch (error) { generateReason = error instanceof Error ? error.message : "Confira o primeiro vencimento." }
    }
  }
  if (!addReason) {
    if (draft.rows.length >= 120) addReason = "O plano já tem o limite de 120 parcelas."
    else {
      try {
        const lastDate = draft.rows.at(-1)?.dueOn
        addDate = lastDate ? nextInstallmentDate(lastDate, draft.interval) : draft.dueDate ? addPaymentDays(draft.dueDate, 0) : nextInstallmentDate(draft.entryDate || draft.today, draft.firstDays)
      } catch (error) { addReason = error instanceof Error ? error.message : "Confira o vencimento e o intervalo antes de adicionar." }
    }
  }
  return { generateReason, addReason, firstDate, addDate, intervalDays }
}
