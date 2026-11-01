
import { erpFetch } from "@/lib/api/client"

import type { Schema } from "@/lib/api/types"
export type ReceivedNote = Schema<"ReceivedNfeSnapshot">

export async function documentHash(bytes: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("")
}

export async function fetchReceivedDocument(note: ReceivedNote, tenantId: string, format: "xml" | "danfe", signal: AbortSignal) {
  const response = await erpFetch(`/api/erp/fiscal/received-nfes/${note.id}/${format}`, {
    cache: "no-store", headers: { "X-Tenant-Id": tenantId },
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
  })
  if (!response.ok) {
    const problem = await response.json().catch(() => null)
    throw new Error(problem?.title || "Documento indisponível")
  }
  const mime = format === "xml" ? "application/xml" : "application/pdf"
  if (!response.headers.get("content-type")?.startsWith(mime)) throw new Error("O serviço devolveu um documento inválido")
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Documento vazio")
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new Error("O documento excede o limite de 8 MiB") }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const expected = format === "xml" ? note.xmlSha256 : response.headers.get("x-pdf-sha256")
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)
    || response.headers.get("x-xml-sha256") !== note.xmlSha256
    || response.headers.get("x-nfe-environment") !== String(note.environment)
    || await documentHash(bytes.buffer) !== expected) throw new Error("O download não corresponde ao documento armazenado")
  if (format === "danfe" && new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("O serviço devolveu um PDF inválido")
  signal.throwIfAborted()
  return { bytes, mime, filename: `${format === "xml" ? "NFE" : "DANFE"}-${note.accessKey}.${format === "xml" ? "xml" : "pdf"}` }
}

export function saveDocument(bytes: Uint8Array<ArrayBuffer>, mime: string, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
  const anchor = document.createElement("a")
  anchor.href = url; anchor.download = filename
  document.body.appendChild(anchor); anchor.click(); anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
