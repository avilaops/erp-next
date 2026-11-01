
import type { Schema } from "@/lib/api/types"
export type ProductInput = Schema<"ProductInput">
export type ProductCommand = { key: string; body: string }
export type ProductDraft = { version: 1; draft: ProductInput; baseline: string; etag: string; uncertain: boolean; conflict: boolean; command: ProductCommand | null }

function isProductInput(value: unknown): value is ProductInput {
  if (!value || typeof value !== "object") return false
  const input = value as Record<string, unknown>
  return ([ ["sku", 80], ["name", 200], ["unit", 6], ["basePrice", 15] ] as const).every(([field, max]) => typeof input[field] === "string" && input[field].length <= max)
    && (input.ncm === null || (typeof input.ncm === "string" && input.ncm.length <= 8))
    && (input.cest === null || (typeof input.cest === "string" && input.cest.length <= 7))
    && (input.status === "active" || input.status === "archived")
    && [input.structureColors, input.upholsteryColors].every(colors => colors === undefined || (Array.isArray(colors) && colors.every(color => typeof color === "string") && colors.join("\n").length <= 1951))
    && (input.photoDataUrl === undefined || (typeof input.photoDataUrl === "string" && input.photoDataUrl.length <= 349000))
}

export function readProductDraft(key: string): { value: ProductDraft | null; error: string } {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return { value: null, error: "" }
    // A draft may retain the photo in the edit, baseline and pending command.
    if (raw.length > 1_100_000) throw new Error("Invalid draft")
    const value = JSON.parse(raw) as ProductDraft
    if (value.version !== 1 || !isProductInput(value.draft) || typeof value.baseline !== "string" || !isProductInput(JSON.parse(value.baseline))
      || typeof value.etag !== "string" || typeof value.uncertain !== "boolean" || typeof value.conflict !== "boolean") throw new Error("Invalid draft")
    if (value.command !== null && (typeof value.command?.key !== "string" || !/^[0-9a-f-]{36}$/i.test(value.command.key)
      || typeof value.command.body !== "string" || !isProductInput(JSON.parse(value.command.body)))) throw new Error("Invalid command")
    if (value.uncertain && !value.command) throw new Error("Missing command")
    return { value, error: "" }
  } catch {
    return { value: null, error: "Não foi possível recuperar o rascunho desta aba. Confira se houve gravação antes de descartar ou iniciar outra edição." }
  }
}

export function writeProductDraft(key: string, value: ProductDraft | null): boolean {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value))
    else sessionStorage.removeItem(key)
    return true
  } catch { return false }
}
