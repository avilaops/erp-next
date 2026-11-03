import { erpFetch } from "@/lib/api/client"
import { documentHash } from "./received-documents"
import { parseNfseDetail, parseNfsePage, type ReceivedNfse } from "./nfse-received-model"

const base = "/api/erp/fiscal/received-nfses"

async function json(response: Response): Promise<unknown> {
  const value = await response.json()
  if (!response.ok) throw new Error(typeof value?.title === "string" ? value.title : "Não foi possível consultar a NFS-e")
  return value
}

export async function readNfsePage(tenantId: string, offset: number, signal: AbortSignal) {
  const response = await erpFetch(`${base}?offset=${offset}&limit=25`, { headers: { "X-Tenant-Id": tenantId }, signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) })
  return parseNfsePage(await json(response), tenantId)
}

export async function readNfseDetail(document: ReceivedNfse, tenantId: string, signal: AbortSignal) {
  const response = await erpFetch(`${base}/${document.id}`, { headers: { "X-Tenant-Id": tenantId }, signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) })
  const value = parseNfseDetail(await json(response), tenantId)
  if (value.id !== document.id || value.companyTaxId !== document.companyTaxId
    || value.document.xmlSha256 !== document.document.xmlSha256 || value.document.accessKey !== document.document.accessKey
    || value.document.environment !== document.document.environment) throw new Error("O documento não corresponde à NFS-e selecionada")
  return value
}

export async function importNfse(file: { xml: string; xmlSha256: string; key: string }, tenantId: string, signal: AbortSignal) {
  const response = await erpFetch(`${base}/import`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId, "Idempotency-Key": file.key },
    body: JSON.stringify({ xml: file.xml }), signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
  })
  const result = parseNfseDetail(await json(response), tenantId)
  if (result.document.xmlSha256 !== file.xmlSha256) throw new Error("O resultado não corresponde ao XML enviado. Atualize os arquivos antes de reenviar")
  return result
}

export async function readNfseXml(document: ReceivedNfse, tenantId: string, signal: AbortSignal) {
  const response = await erpFetch(`${base}/${document.id}/xml`, { headers: { "X-Tenant-Id": tenantId }, signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) })
  if (!response.ok) { await json(response); throw new Error("XML indisponível") }
  if (!response.headers.get("content-type")?.startsWith("application/xml")) throw new Error("O serviço devolveu um documento inválido")
  const reader = response.body?.getReader()
  if (!reader) throw new Error("XML vazio")
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 1_048_576) { await reader.cancel(); throw new Error("XML acima do limite de 1 MiB") }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  if (!size || response.headers.get("x-xml-sha256") !== document.document.xmlSha256 || await documentHash(bytes.buffer) !== document.document.xmlSha256) throw new Error("O XML não corresponde ao arquivo selecionado")
  signal.throwIfAborted()
  return bytes
}
