import { erpFetch } from "@/lib/api/client"
import { documentHash } from "./received-documents"

export type CteDocument = {
  id: string; runId: string; environment: "homologation"; companyTaxId: string
  nsu: string; schema: string; kind: "full" | "event" | "unrecognized"
  xmlSha256: string; verification: "pending"; createdAt: string
}
export type CteSnapshot = {
  tenantId: string; environment: "homologation"; companyTaxId: string | null
  lastNsu: string; maxNsu: string; lastCode: string | null; running: boolean
}
export type CtePage = { snapshot: CteSnapshot; data: CteDocument[]; total: number }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const nsu = /^[0-9]{15}$/
const sha256 = /^[a-f0-9]{64}$/
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const failures: Record<string, string> = { transport_uncertain: "Resposta da captura não confirmada", invalid_batch: "Lote recusado por inconsistência", persistence_failed: "Falha ao armazenar o lote" }
const validCode = (value: unknown) => value === null || typeof value === "string" && (/^[0-9]{3}$/.test(value) || Object.hasOwn(failures, value))
export const cteCodeLabel = (code: string) => failures[code] || `Retorno SEFAZ ${code}`

function isDocument(value: unknown): value is CteDocument {
  if (!record(value)) return false
  return typeof value.id === "string" && uuid.test(value.id)
    && typeof value.runId === "string" && uuid.test(value.runId)
    && value.environment === "homologation"
    && typeof value.companyTaxId === "string" && /^[0-9]{14}$/.test(value.companyTaxId)
    && typeof value.nsu === "string" && nsu.test(value.nsu)
    && typeof value.schema === "string" && value.schema.length <= 100 && /^[a-zA-Z0-9_.-]+\.xsd$/.test(value.schema)
    && ["full", "event", "unrecognized"].includes(String(value.kind))
    && typeof value.xmlSha256 === "string" && sha256.test(value.xmlSha256)
    && value.verification === "pending"
    && typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt))
}

async function readJson(resource: string, tenantId: string, signal: AbortSignal): Promise<unknown> {
  const response = await erpFetch(resource, { headers: { "X-Tenant-Id": tenantId }, signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) })
  const value: unknown = await response.json()
  if (!response.ok) throw new Error(record(value) && typeof value.title === "string" ? value.title : "Não foi possível consultar os arquivos CT-e")
  return value
}

export async function readCtePage(tenantId: string, offset: number, signal: AbortSignal): Promise<CtePage> {
  const [snapshot, page] = await Promise.all([
    readJson("/api/erp/fiscal/cte-distribution/status", tenantId, signal),
    readJson(`/api/erp/fiscal/cte-distribution/documents?offset=${offset}&limit=25`, tenantId, signal),
  ])
  if (!record(snapshot) || snapshot.tenantId !== tenantId || snapshot.environment !== "homologation"
    || !(snapshot.companyTaxId === null || typeof snapshot.companyTaxId === "string" && /^[0-9]{14}$/.test(snapshot.companyTaxId))
    || typeof snapshot.lastNsu !== "string" || !nsu.test(snapshot.lastNsu)
    || typeof snapshot.maxNsu !== "string" || !nsu.test(snapshot.maxNsu)
    || typeof snapshot.running !== "boolean" || !validCode(snapshot.lastCode)
    || !record(page) || page.tenantId !== tenantId || page.environment !== "homologation"
    || !Array.isArray(page.data) || page.data.length > 25 || !page.data.every(isDocument)
    || !page.data.every(document => document.companyTaxId === snapshot.companyTaxId)
    || !Number.isSafeInteger(page.total) || (page.total as number) < page.data.length) throw new Error("A resposta CT-e não corresponde à empresa ou ao ambiente. Atualize os arquivos")
  return { snapshot: snapshot as CteSnapshot, data: page.data, total: page.total as number }
}

export async function readCteXml(document: CteDocument, tenantId: string, signal: AbortSignal) {
  const value = await readJson(`/api/erp/fiscal/cte-distribution/documents/${document.id}`, tenantId, signal)
  if (!record(value) || value.id !== document.id || value.runId !== document.runId
    || value.environment !== "homologation" || value.companyTaxId !== document.companyTaxId
    || value.nsu !== document.nsu || value.schema !== document.schema || value.kind !== document.kind
    || value.verification !== "pending" || value.xmlSha256 !== document.xmlSha256
    || typeof value.xml !== "string") throw new Error("O XML não corresponde ao arquivo selecionado")
  const bytes = new TextEncoder().encode(value.xml)
  if (!bytes.byteLength || bytes.byteLength > 2_097_152 || await documentHash(bytes.buffer) !== document.xmlSha256) throw new Error("O XML não corresponde ao arquivo selecionado")
  signal.throwIfAborted()
  return bytes
}

export async function readCteRun(document: CteDocument, tenantId: string, signal: AbortSignal) {
  const value = await readJson(`/api/erp/fiscal/cte-distribution/runs/${document.runId}`, tenantId, signal)
  if (!record(value) || value.runId !== document.runId || value.environment !== "homologation"
    || value.companyTaxId !== document.companyTaxId || typeof value.status !== "string"
    || !["running", "completed", "rejected", "failed", "unknown"].includes(value.status)
    || !Number.isInteger(value.documentCount) || (value.documentCount as number) < 0 || (value.documentCount as number) > 50
    || !validCode(value.code)) throw new Error("A captura não corresponde ao arquivo selecionado")
  const labels: Record<string, string> = { running: "Captura em andamento", completed: "Captura concluída", rejected: "Captura rejeitada", failed: "Captura não aplicada", unknown: "Resultado da captura não confirmado" }
  return `${labels[value.status]}${typeof value.code === "string" ? ` · ${cteCodeLabel(value.code)}` : ""} · ${value.documentCount} arquivo(s). A situação fiscal externa permanece pendente.`
}
