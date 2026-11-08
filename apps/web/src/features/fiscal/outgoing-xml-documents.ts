import { erpFetch } from "@/lib/api/client"
import { documentHash } from "./received-documents"

// Replaced by the generated schema once the API contract is regenerated.
export interface OutgoingXmlNote {
  id: number; accessKey: string; issuerDocument: string; issuerName: string
  recipientDocument: string | null; recipientName: string; number: number; series: number
  issuedAt: string; totalCents: number; itemCount: number; environment: number
  xmlSha256: string; createdAt: string
}
export const companyChanged = "A empresa da sessão mudou. Atualize a página."
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Resposta fiscal inválida")
  return value as Record<string, unknown>
}
export function parseOutgoingXmlNote(value: unknown): OutgoingXmlNote {
  const note = object(value)
  const text = (key: string) => typeof note[key] === "string" && (note[key] as string).length > 0
  const integer = (key: string, min: number, max: number) => Number.isSafeInteger(note[key]) && Number(note[key]) >= min && Number(note[key]) <= max
  if (!integer("id", 1, Number.MAX_SAFE_INTEGER) || !text("accessKey") || !/^\d{44}$/.test(String(note.accessKey))
    || String(note.accessKey).slice(20, 22) !== "55" || !/^\d{11}(\d{3})?$/.test(String(note.issuerDocument))
    || !text("issuerName") || !text("recipientName") || (note.recipientDocument !== null && !/^\d{11}(\d{3})?$/.test(String(note.recipientDocument)))
    || !integer("number", 1, 999999999) || !integer("series", 0, 999) || !integer("totalCents", 0, 99999999999999)
    || !integer("itemCount", 1, 990) || ![1, 2].includes(Number(note.environment)) || typeof note.environment !== "number"
    || !text("issuedAt") || !Number.isFinite(Date.parse(String(note.issuedAt))) || !text("createdAt") || !Number.isFinite(Date.parse(String(note.createdAt)))
    || !/^[a-f0-9]{64}$/.test(String(note.xmlSha256))) throw new Error("Resposta fiscal inválida")
  return note as unknown as OutgoingXmlNote
}
export async function readJson(path: string, signal: AbortSignal, tenant?: string) {
  const response = await erpFetch(path, { signal, headers: tenant ? { "X-Tenant-Id": tenant } : undefined })
  const value: unknown = await response.json()
  if (!response.ok) throw new Error(typeof object(value).title === "string" ? String(object(value).title) : "Consulta fiscal indisponível")
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Resposta fiscal inválida")
  return object(value)
}
export async function activeCompany(signal: AbortSignal, expected?: string) {
  const me = await readJson("/api/erp/me", signal, expected)
  const tenant = object(me.tenant).id
  if (typeof tenant !== "string" || !/^[a-f0-9-]{36}$/i.test(tenant) || expected && tenant !== expected) throw new Error(companyChanged)
  return tenant
}
export async function fetchOutgoingXmlDocument(note: OutgoingXmlNote, tenantId: string, format: "xml" | "danfe", signal: AbortSignal) {
  await activeCompany(signal, tenantId)
  const response = await erpFetch(`/api/erp/fiscal/outgoing-imports/${note.id}/${format}`, {
    headers: { "X-Tenant-Id": tenantId }, signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
  })
  if (!response.ok) { const problem = await response.json().catch(() => null); throw new Error(problem?.title || "Documento indisponível") }
  const mime = format === "xml" ? "application/xml" : "application/pdf"
  if (!response.headers.get("content-type")?.startsWith(mime)) throw new Error("Documento inválido")
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Documento vazio")
  const chunks: Uint8Array[] = []; let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new Error("Documento excede 8 MiB") }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const expected = format === "xml" ? note.xmlSha256 : response.headers.get("x-pdf-sha256")
  if (!expected || !/^[a-f0-9]{64}$/.test(expected) || response.headers.get("x-xml-sha256") !== note.xmlSha256
    || response.headers.get("x-nfe-environment") !== String(note.environment) || await documentHash(bytes.buffer) !== expected
    || format === "danfe" && new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("O download não corresponde ao documento armazenado")
  await activeCompany(signal, tenantId)
  signal.throwIfAborted()
  return { bytes, mime, filename: `${format === "xml" ? "NFE" : "DANFE"}-${note.accessKey}.${format === "xml" ? "xml" : "pdf"}` }
}
