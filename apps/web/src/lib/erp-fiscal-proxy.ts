import { currentSession, erpConfiguration } from "./erp-session"

const noStore = { "Cache-Control": "no-store, no-transform", "X-Content-Type-Options": "nosniff" }
const failure = (title: string, status: number) => Response.json({ title }, { status, headers: noStore })

async function bounded(stream: ReadableStream<Uint8Array> | null, maximum: number) {
  const reader = stream?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  if (reader) for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maximum) { await reader.cancel(); throw new RangeError("Document exceeds limit") }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export async function forwardFiscal(request: Request, resource: string) {
  const download = /^\/received-nfes\/[1-9][0-9]{0,18}\/(xml|danfe)$/.exec(resource) || /^\/nfe\/[a-f0-9-]{36}\/(xml)$/i.exec(resource) || /^\/monitor\/documents\/[1-9][0-9]{0,18}\/(xml)$/.exec(resource)
  const manifestation = /^\/monitor\/documents\/[1-9][0-9]{0,18}\/manifest$/.test(resource)
  const document = /^\/received-nfes\/[1-9][0-9]{0,18}$/.test(resource)
  const draft = /^\/nfe\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resource)
  const preparation = /^\/order-preparations\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resource)
  const operationRead = /^\/nfe\/[a-f0-9-]{36}\/(?:emission|events)$|^\/distribution\/(?:status|documents(?:\/[0-9]{15})?)$|^\/received-nfes\/[1-9][0-9]{0,18}\/purchase$|^\/manifestations\/[a-f0-9-]{36}$/i.test(resource)
  const operationWrite = /^\/nfe\/[a-f0-9-]{36}\/(?:issue|consult|cancel|correction)$|^\/distribution\/query$|^\/received-nfes\/[1-9][0-9]{0,18}\/purchase$|^\/order-cancellations\/[a-f0-9-]{36}\/process$|^\/manifestations\/[a-f0-9-]{36}\/reconcile$/i.test(resource)
  const valid = request.method === "GET"
    ? ["/config", "/readiness", "/received-nfes", "/certificate", "/nfe", "/issued-nfes", "/manifestations", "/monitor"].includes(resource) || operationRead || document || draft || preparation || !!download
    : request.method === "PUT" && (["/config", "/certificate"].includes(resource) || draft) || request.method === "DELETE" && resource === "/certificate" || request.method === "POST" && (["/received-nfes/import", "/nfe", "/manifestations", "/number-voids", "/monitor/sync"].includes(resource) || operationWrite || manifestation)
  if (!valid) return failure("Recurso fiscal inválido", 400)
  let body: Uint8Array<ArrayBuffer> | undefined
  try {
    const config = erpConfiguration()
    const session = await currentSession()
    if (!session) return failure("Entre para acessar o fiscal da empresa", 401)
    const write = request.method !== "GET"
    if (write && request.headers.get("origin") !== config.origin) return failure("Origem não autorizada", 403)
    if ((write || download) && request.headers.get("x-tenant-id") !== session.tenantId) return failure("A empresa da sessão mudou. Recarregue os documentos antes de continuar", 409)
    const upstream = new URL(`${config.api}/api/v1/fiscal${resource}`)
    const query = new URL(request.url).searchParams
    for (const [key, value] of query) {
      const allowed = resource === "/received-nfes" ? ["q", "from", "to", "offset", "limit"] : ["/nfe", "/issued-nfes"].includes(resource) ? ["cursor", "limit"] : resource === "/manifestations" ? ["offset", "limit", "accessKey"] : ["/distribution/documents", "/monitor"].includes(resource) ? ["offset", "limit"] : []
      if (!allowed.includes(key) || query.getAll(key).length !== 1) return failure("Filtro fiscal inválido", 400)
      upstream.searchParams.set(key, value)
    }
    const headers = new Headers({ Authorization: `Bearer ${session.accessToken}`, "X-Tenant-Id": session.tenantId, Accept: download ? "application/pdf, application/xml, application/problem+json" : "application/json" })
    if (write && request.method !== "DELETE") {
      if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return failure("Envie JSON", 415)
      try { body = new Uint8Array(await bounded(request.body, resource === "/certificate" ? 128 * 1024 : 1024 * 1024)) }
      catch { return failure(resource === "/certificate" ? "Certificado excede o limite de envio" : "Documento excede o limite de 1 MiB", 413) }
      headers.set("Content-Type", "application/json")
    }
    const etag = request.headers.get("if-match")
    if (write && etag) headers.set("If-Match", etag)
    const command = request.headers.get("idempotency-key")
    if (write && command) headers.set("Idempotency-Key", command)
    const response = await fetch(upstream, { method: request.method, headers, body, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(operationWrite || resource === "/manifestations" || resource === "/number-voids" ? 110_000 : download || resource.startsWith("/monitor/") ? 60_000 : resource === "/certificate" ? 45_000 : 15_000) })
    let bytes: Buffer
    try { bytes = await bounded(response.body, 8 * 1024 * 1024) }
    catch { return failure("Resposta fiscal excede o limite de download", 502) }
    const type = response.headers.get("content-type") || ""
    if (response.ok && download) {
      const pdf = download[1] === "danfe"
      if (pdf ? !type.startsWith("application/pdf") || bytes.subarray(0, 5).toString("ascii") !== "%PDF-" : !type.startsWith("application/xml")) return failure("O serviço devolveu um documento inválido", 502)
    } else if (!type.includes("json")) return failure("Resposta fiscal indisponível", 502)
    const output = new Headers({ ...noStore, "Content-Type": type })
    for (const name of ["etag", "content-disposition", "idempotency-replayed", "retry-after", "x-request-id", "x-xml-sha256", "x-pdf-sha256", "x-nfe-environment", "x-nfe-authorization-check"]) {
      const value = response.headers.get(name)
      if (value) output.set(name, value)
    }
    return new Response(new Uint8Array(bytes), { status: response.status, headers: output })
  } catch { return failure("Não foi possível confirmar a operação fiscal. Atualize a tela antes de repetir", 503) }
  finally { body?.fill(0) }
}
