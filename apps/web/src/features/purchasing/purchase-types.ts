
import type { Schema } from "@/lib/api/types"
import { normalizeDecimal } from "@/lib/decimal-input"

export type Purchase = Schema<"PurchaseSummary">
export type PurchaseLine = Schema<"PurchaseLine">
export type PurchaseDetail = Schema<"PurchaseSnapshot">
export type PurchaseList = Schema<"PurchaseList">
export type Receipt = Schema<"ReceiptSummary">
export type ReceiptDetail = Schema<"ReceiptSnapshot">
export type ReceiptList = Schema<"ReceiptList">
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

