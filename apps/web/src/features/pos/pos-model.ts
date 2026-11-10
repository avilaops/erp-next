import { normalizeDecimal } from "@/lib/decimal-input"

export type Account = { id: string; code: string; name: string; accountType: string; status: string }
export type Product = { id: string; sku: string; name: string; unit: string; unitPrice: string; available: string; pricingAvailable: boolean; pricingError?: string }
export type CartItem = Product & { quantity: string }
export type Payment = { method: "cash" | "pix" | "debit" | "credit"; accountId: string; amount: string | null; tendered: string }
export type SaleItem = { productId: string; sku: string; name: string; quantity: string; unitPrice: string; total?: string; amount?: string }
export type Sale = { id: string; sessionId: string; status: string; total: string; revision: number; createdAt: string; cancelledAt?: string | null; customerName?: string | null; items?: SaleItem[]; payments?: { method: string; accountId: string; amount: string; tendered?: string | null; change?: string | null }[] }
export type Movement = { id: string; direction: string; amount: string; reason: string; createdAt: string }
export type CashSession = { id: string; register: string; cashAccountId: string; openingAmount: string; status: string; revision: number; openedAt: string; closedAt: string | null; totals: { cash: string; pix: string; debit: string; credit: string; supplies: string; withdrawals: string; refunds: string; expectedCash: string; countedCash: string | null; difference: string | null }; sales: Sale[]; movements: Movement[] }
export type Envelope<T> = { tenantId: string; canEdit: boolean; canClose?: boolean; canCancel?: boolean; data: T }
export type Listing<T> = Envelope<T[]> & { total: number; offset: number; limit: number }
export const methodNames: Record<string, string> = { cash: "Dinheiro", pix: "PIX", debit: "Cartão de débito", credit: "Cartão de crédito" }

export function amount(raw: string) { return normalizeDecimal(raw, 2) }
export function cents(raw: string) {
  const negative = raw.trim().startsWith("-")
  const value = amount(negative ? raw.trim().slice(1) : raw)
  if (!value || !/^-?\d+\.\d{2}$/.test(value)) return null
  const result = Number(value.replace(".", "")) * (negative ? -1 : 1)
  return Number.isSafeInteger(result) ? result : null
}
export function decimal(value: number) { return (value / 100).toFixed(2) }
export function money(raw: string | number | null | undefined) {
  const value = typeof raw === "number" ? raw : raw == null ? null : cents(raw)
  return value == null ? "Não informado" : (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}
export function lineCents(item: CartItem) {
  const quantity = normalizeDecimal(item.quantity, 6)
  const price = cents(item.unitPrice)
  if (!quantity || !/^\d+\.\d{6}$/.test(quantity) || price == null || price < 0) return null
  const result = (BigInt(quantity.replace(".", "")) * BigInt(price) + BigInt(500000)) / BigInt(1000000)
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null
}
export function cartCents(items: CartItem[]) {
  let result = 0
  for (const item of items) { const value = lineCents(item); if (value == null) return null; result += value }
  return Number.isSafeInteger(result) ? result : null
}
export function when(value: string | null) { return value ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—" }
