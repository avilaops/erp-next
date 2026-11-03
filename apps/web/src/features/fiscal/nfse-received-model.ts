import type { Schema } from "@/lib/api/types"

export type ReceivedNfse = Schema<"ReceivedNfseSnapshot">
export type ReceivedNfsePage = Schema<"ReceivedNfsePage">

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const hash = /^[a-f0-9]{64}$/
const cents = /^(?:0|[1-9][0-9]{0,16})$/
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value))
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0

function party(value: unknown) {
  return record(value) && typeof value.kind === "string" && ["CNPJ", "CPF", "NIF", "no_nif"].includes(value.kind)
    && text(value.value) && (value.name === null || typeof value.name === "string")
}

function isDocument(value: unknown): value is ReceivedNfse {
  if (!record(value) || !record(value.document)) return false
  const data = value.document, verification = data.verification
  if (!record(verification) || !record(data.recipient)) return false
  const layout = data.schemaVersion === "1.00" && verification.layout === "official_schema_valid" && verification.correction === null
    || data.schemaVersion === "1.01" && verification.layout === "local_profile_valid" && verification.correction === "nfse-1.01-dps-series-regex-v1"
  return typeof value.id === "string" && uuid.test(value.id)
    && typeof value.companyTaxId === "string" && /^[0-9]{14}$/.test(value.companyTaxId)
    && date(value.createdAt) && data.source === "nfse_nacional"
    && typeof data.accessKey === "string" && /^[0-9]{50}$/.test(data.accessKey)
    && typeof data.environment === "string" && ["production", "homologation"].includes(data.environment)
    && typeof data.xmlSha256 === "string" && hash.test(data.xmlSha256)
    && party(data.issuer) && party(data.provider) && party(data.recipient)
    && data.recipient.kind === "CNPJ" && data.recipient.value === value.companyTaxId
    && text(data.number) && /^[0-9]+$/.test(data.number)
    && typeof data.municipalityCode === "string" && /^[0-9]{7}$/.test(data.municipalityCode)
    && date(data.issuedAt) && date(data.processedAt)
    && text(data.processingCode) && text(data.serviceCode) && text(data.description)
    && typeof data.serviceCents === "string" && cents.test(data.serviceCents)
    && typeof data.netCents === "string" && cents.test(data.netCents)
    && layout && verification.signature === "not_verified" && verification.currentStatus === "not_queried"
}

export function parseNfsePage(value: unknown, tenantId: string): ReceivedNfsePage {
  if (!record(value) || value.tenantId !== tenantId || typeof value.canImport !== "boolean"
    || !Array.isArray(value.data) || value.data.length > 25 || !value.data.every(isDocument)
    || new Set(value.data.map(document => document.id)).size !== value.data.length
    || !Number.isSafeInteger(value.total) || (value.total as number) < value.data.length) {
    throw new Error("A resposta NFS-e não corresponde à empresa ou ao arquivo esperado. Atualize os arquivos")
  }
  return value as ReceivedNfsePage
}

export function parseNfseDetail(value: unknown, tenantId: string): ReceivedNfse {
  if (!record(value) || value.tenantId !== tenantId || !isDocument(value.data)) {
    throw new Error("A resposta NFS-e não corresponde à empresa ou ao arquivo esperado. Atualize os arquivos")
  }
  return value.data
}

export async function decodeNfseBytes(bytes: ArrayBuffer) {
  if (!bytes.byteLength || bytes.byteLength > 1_048_576) throw new Error("Selecione um XML nacional de até 1 MiB")
  let xml: string
  try { xml = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { throw new Error("O XML precisa estar em UTF-8 válido") }
  if (xml.includes("\0")) throw new Error("O XML contém um caractere inválido")
  const xmlSha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("")
  return { xml, xmlSha256 }
}

export function nfseMoney(value: string) {
  const amount = BigInt(value), scale = BigInt(100)
  return `R$ ${(amount / scale).toLocaleString("pt-BR")},${(amount % scale).toString().padStart(2, "0")}`
}
