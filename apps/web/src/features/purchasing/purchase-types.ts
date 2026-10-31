import { normalizeDecimal } from "@/lib/decimal-input"

export type Purchase = { id: string; supplierId: string; supplierName: string; supplierTaxId: string; dueDate: string; amount: string; status: string; revision: number }
export type PurchaseLine = { productId: string; sku: string; name: string; unit: string; quantity: string; receivedQuantity: string; unitCost: string; amount: string }
export type PurchaseDetail = { tenantId: string; canEdit: boolean; data: Purchase; items: PurchaseLine[]; receiptCount: number }
export type PurchaseList = { tenantId: string; canEdit: boolean; data: Purchase[]; total: number }
export type Receipt = { id: string; orderId: string; reference: string; occurredOn: string; amount: string; payableId: string | null; reversalId?: string | null; orderRevision?: number }
export type ReceiptDetail = { tenantId: string; data: Receipt; items: { productId: string; unit: string; quantity: string; amount: string }[] }
export type ReceiptList = { tenantId: string; data: Receipt[]; total: number }
export const purchaseLabels: Record<string, string> = { draft: "Rascunho", confirmed: "Confirmado", partially_received: "Recebido parcialmente", received: "Recebido", closed: "Saldo encerrado", cancelled: "Cancelado" }
export const purchaseLink = "font-medium text-primary underline underline-offset-4"
export const purchaseSelect = "block h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3"

// Keep fixed-point values as strings/integers; the API remains the authority for totals.
export function fixedValue(raw: string, places: number): bigint | null {
  const value = normalizeDecimal(raw, places)
  return value === null ? null : BigInt(value.replace(".", ""))
}
export function fixedText(value: bigint, places: number): string {
  const digits = value.toString().padStart(places + 1, "0")
  return `${digits.slice(0, -places)}.${digits.slice(-places)}`
}
export function money(value: string): string {
  const [whole, fraction = "00"] = value.split(".")
  return `R$ ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction}`
}
