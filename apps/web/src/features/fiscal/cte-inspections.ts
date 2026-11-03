import { erpFetch } from "@/lib/api/client"
import { parseCteInspection } from "./cte-inspection-model"
import type { CteDocument } from "./cte-documents"

export async function readCteInspection(document: CteDocument, tenantId: string, signal: AbortSignal, command?: string) {
  const response = await erpFetch(`/api/erp/fiscal/cte-distribution/documents/${document.id}/${command ? "inspect" : "inspection"}`, {
    method: command ? "POST" : "GET",
    headers: { "X-Tenant-Id": tenantId, ...(command ? { "Content-Type": "application/json", "Idempotency-Key": command } : {}) },
    ...(command ? { body: "{}" } : {}),
    signal: AbortSignal.any([signal, AbortSignal.timeout(command ? 110_000 : 20_000)]),
  })
  let value: unknown
  try { value = await response.json() } catch { throw new Error("Resposta da conferência CT-e inválida. Atualize os arquivos") }
  if (!response.ok) {
    const title = value && typeof value === "object" && "title" in value ? value.title : null
    throw new Error(typeof title === "string" && title.trim() && title.length <= 300 ? title : "Conferência CT-e não confirmada. Atualize os arquivos antes de repetir")
  }
  const result = parseCteInspection(value, document, tenantId)
  if (command && !result.data) throw new Error("Conferência CT-e não confirmada. Atualize os arquivos antes de repetir")
  return result
}
