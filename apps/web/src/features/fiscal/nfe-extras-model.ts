import type { Schema } from "@/lib/api/types"
export type Transport = Schema<"Transport">
export type Retentions = Schema<"Retentions">
export const emptyTransport = (): Transport => ({ carrierTaxId: null, carrierName: null, stateRegistration: null, address: null, city: null, state: null, plate: null, vehicleState: null, rntc: null, volumes: null, volumeKind: null, volumeNumber: null, brand: null, netWeight: null, grossWeight: null })
export const emptyRetentions = (): Retentions => ({ pis: null, cofins: null, csll: null, incomeTaxBase: null, incomeTax: null, socialSecurityBase: null, socialSecurity: null })
export type Installment = { number: string; dueDate: string; amount: string }
export type FiscalExtras = {
  transport?: Transport | null; retentions?: Retentions | null;
  authorizedXml?: { taxId: string; name?: string | null }[];
  intermediary?: { taxId: string; registration: string } | null;
  taxAuthorityInformation?: string | null; paymentTerms?: string | null;
  financialCategoryId?: string | null; installments?: Installment[];
}

export function generateInstallments(total: string, count: number, firstDueDate: string, interval: number): Installment[] {
  if (!/^\d+\.\d{2}$/.test(total) || !Number.isInteger(count) || count < 1 || count > 120 || !Number.isInteger(interval) || interval < 1 || interval > 365) throw new Error("Confira quantidade de parcelas e intervalo.")
  const first = new Date(`${firstDueDate}T12:00:00Z`)
  if (!Number.isFinite(first.valueOf()) || first.toISOString().slice(0, 10) !== firstDueDate) throw new Error("Informe o primeiro vencimento.")
  const cents = BigInt(total.replace(".", "")), divisor = BigInt(count)
  if (cents < divisor) throw new Error("O valor da nota deve permitir parcelas de pelo menos um centavo.")
  return Array.from({ length: count }, (_, index) => {
    const value = cents / divisor + (BigInt(index) < cents % divisor ? BigInt(1) : BigInt(0))
    const due = new Date(first); due.setUTCDate(due.getUTCDate() + index * interval)
    return { number: String(index + 1).padStart(3, "0"), dueDate: due.toISOString().slice(0, 10), amount: `${value / BigInt(100)}.${String(value % BigInt(100)).padStart(2, "0")}` }
  })
}
