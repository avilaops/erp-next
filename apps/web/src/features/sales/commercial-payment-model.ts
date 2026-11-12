export type PaymentInstallment = { paymentMethodId: string; dueOn: string; amountCents: number }
const maximumCents = 99_999_999_999_999

export function addPaymentDays(date: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(days) || days < 0 || days > 500_000) throw Error("Confira os vencimentos e o intervalo das parcelas.")
  const [year, month, day] = date.split("-").map(Number)
  const current = new Date(Date.UTC(year, month - 1, day))
  if (year < 1900 || current.getUTCFullYear() !== year || current.getUTCMonth() !== month - 1 || current.getUTCDate() !== day) throw Error("Informe uma data válida para o pagamento.")
  current.setUTCDate(current.getUTCDate() + days)
  if (current.getUTCFullYear() > 9999) throw Error("O vencimento ultrapassa o limite do calendário.")
  return current.toISOString().slice(0, 10)
}

export function installmentPlan(balance: number, count: number, first: string, interval: number, method: string): PaymentInstallment[] {
  if (!Number.isSafeInteger(balance) || balance < 0 || balance > maximumCents || !Number.isInteger(count) || count < 1 || count > 120 || !Number.isInteger(interval) || interval < 0 || interval > 3650) throw Error("Confira o saldo, a quantidade e o intervalo das parcelas.")
  if (!balance) return []
  if (balance < count || !method) throw Error("Cada parcela deve ter valor positivo e uma forma de pagamento.")
  const base = BigInt(balance) / BigInt(count)
  const remainder = Number(BigInt(balance) % BigInt(count))
  return Array.from({ length: count }, (_, index) => ({ paymentMethodId: method, dueOn: addPaymentDays(first, index * interval), amountCents: Number(base) + (index < remainder ? 1 : 0) }))
}

export function nextInstallmentDate(lastDate: string, interval: string): string {
  if (!/^\d{1,4}$/.test(interval) || Number(interval) > 3650) throw Error("Informe um intervalo entre 0 e 3650 dias.")
  return addPaymentDays(lastDate, Number(interval))
}

export function entryFromPercent(total: number, raw: string): number | null {
  if (!Number.isSafeInteger(total) || total <= 0 || total > maximumCents || !/^\d{1,3}(?:[.,]\d{1,2})?$/.test(raw.trim())) return null
  const [whole, fraction = ""] = raw.trim().replace(",", ".").split(".")
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
  if (bps > 10000) return null
  return Number((BigInt(total) * BigInt(bps) + BigInt(5000)) / BigInt(10000))
}

export function entryPercent(entry: number, total: number): string {
  if (!Number.isSafeInteger(entry) || !Number.isSafeInteger(total) || entry < 0 || total <= 0 || entry > total) return ""
  const bps = Number((BigInt(entry) * BigInt(10000) + BigInt(total) / BigInt(2)) / BigInt(total))
  return (bps / 100).toFixed(2).replace(".", ",")
}

export function paymentToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date())
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-")
}

export type PaymentMethod = { id: string; name: string; kind: string }
export type CheckoutInput = {
  entry: { paymentMethodId: string | null; dueOn: string | null }
  installments: PaymentInstallment[]
  stateRegistration: string | null
  manufacturingDays: number | null
  deliveryNotes: string
  paymentNotes: string
  notes: string
}
export type CheckoutSnapshot = Omit<CheckoutInput, "entry" | "installments"> & {
  confirmationCreatesReceivables: boolean
  entry: CheckoutInput["entry"] & { amountCents: number; paymentMethod: { id: string; name: string; modality: string } | null }
  installments: (PaymentInstallment & { id: string; number: number; paymentMethod: { id: string; name: string; modality: string } })[]
  customer: { legalName?: string; tradeName?: string | null; taxId?: string; email?: string | null; phone?: string | null; addresses?: { street: string; number: string; complement?: string | null; district: string; city: string; state: string; postalCode: string; primary: boolean }[]; contacts?: { name: string; email?: string | null; phone?: string | null; primary: boolean }[] }
}
