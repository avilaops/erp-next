import "server-only"

import { currentSession, erpConfiguration } from "../auth/erp-session"

const noStore = { "Cache-Control": "no-store" }
const failure = (title: string, status: number) => Response.json({ title, status }, { status, headers: noStore })
async function bounded(body: ReadableStream<Uint8Array> | null, maximum: number) {
  const reader = body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return Buffer.concat(chunks)
    size += value.byteLength
    if (size > maximum) { await reader.cancel(); throw new RangeError("Body exceeds limit") }
    chunks.push(value)
  }
}
export async function forwardDanfe(request: Request) {
  try {
    const config = erpConfiguration()
    const session = await currentSession()
    if (!session) return failure("Entre para gerar o DANFE da sua empresa", 401)
    if (request.headers.get("origin") !== config.origin) return failure("Origem não autorizada", 403)
    if (request.headers.get("x-tenant-id") !== session.tenantId) return failure("A empresa da sessão mudou. Selecione novamente o XML", 409)
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return failure("Envie JSON", 415)
    let body: Buffer
    try { body = await bounded(request.body, 1024 * 1024) } catch { return failure("XML excede o limite de envio", 413) }
    const response = await fetch(`${config.api}/api/v1/fiscal/danfe`, {
      method: "POST", headers: { Authorization: `Bearer ${session.accessToken}`, "X-Tenant-Id": session.tenantId, "Content-Type": "application/json", Accept: "application/pdf, application/problem+json" },
      body: new Uint8Array(body), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(60_000),
    })
    const bytes = await bounded(response.body, 8 * 1024 * 1024)
    const type = response.headers.get("content-type") || ""
    if (response.ok && (!type.startsWith("application/pdf") || bytes.subarray(0, 5).toString("ascii") !== "%PDF-")) return failure("O serviço não devolveu um PDF válido", 502)
    if (!response.ok && !type.includes("json")) return failure("O serviço fiscal recusou a geração", 502)
    const headers = new Headers({ ...noStore, "Content-Type": type, "X-Content-Type-Options": "nosniff" })
    for (const name of ["content-disposition", "x-request-id", "x-xml-sha256", "x-pdf-sha256", "x-nfe-authorization-check", "x-nfe-environment"]) {
      const value = response.headers.get(name)
      if (value) headers.set(name, value)
    }
    return new Response(new Uint8Array(bytes), { status: response.status, headers })
  } catch { return failure("Não foi possível validar e gerar o DANFE. O XML foi preservado no seu dispositivo", 503) }
}
