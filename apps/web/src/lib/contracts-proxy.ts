import { currentSession, erpConfiguration, uuidPattern } from "@/lib/erp-session"

const contractPath = /^(?:|\/options\/[a-f0-9-]{36}|\/[a-f0-9-]{36}(?:\/(?:review|send|sync)|\/files\/[a-f0-9-]{36})?)$/i

export async function contractsProxy(request: Request, path = "") {
  return forwardContracts(request, path, false)
}

export async function contractTemplatesProxy(request: Request, path = "") {
  return forwardContracts(request, path, true)
}

async function forwardContracts(request: Request, path: string, templates: boolean) {
  const allowedPath = templates ? /^(?:|\/catalog|\/[a-f0-9-]{36}(?:\/(?:pdf|import|publish))?)$/i : contractPath
  if (!allowedPath.test(path)) return Response.json({ title: "Recurso inválido" }, { status: 404 })
  try {
    const session = await currentSession()
    if (!session) return Response.json({ title: "Entre para acessar os contratos" }, { status: 401 })
    const config = erpConfiguration()
    if (request.method !== "GET" && request.headers.get("origin") !== config.origin) return Response.json({ title: "Origem não autorizada" }, { status: 403 })
    if (request.method !== "GET" && request.headers.get("x-tenant-id") !== session.tenantId) return Response.json({ title: "A empresa da sessão mudou. Recarregue antes de continuar" }, { status: 409 })
    const url = new URL(`${config.api}/api/v1/${templates ? "contract-template-drafts" : "commercial-contracts"}${path}`)
    for (const [key, value] of new URL(request.url).searchParams) {
      if (templates || path || !["orderId", "customerId", "offset"].includes(key) || new URL(request.url).searchParams.getAll(key).length !== 1) return Response.json({ title: "Filtro inválido" }, { status: 400 })
      url.searchParams.set(key, value)
    }
    const headers = new Headers({ Authorization: `Bearer ${session.accessToken}`, "X-Tenant-Id": session.tenantId })
    for (const name of ["if-match", "idempotency-key"]) { const value = request.headers.get(name); if (value) headers.set(name, value) }
    let body: Uint8Array | undefined
    if (request.method === "POST") {
      if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ title: "Envie JSON" }, { status: 415 })
      const chunks: Uint8Array[] = []
      const reader = request.body?.getReader()
      let size = 0
      if (reader) for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > (templates ? 8 * 1024 * 1024 : 65_536)) { await reader.cancel(); return Response.json({ title: "Documento muito grande" }, { status: 413 }) }
        chunks.push(value)
      }
      body = Buffer.concat(chunks)
      headers.set("Content-Type", "application/json")
    }
    const upstream = await fetch(url, { method: request.method, headers, body: body as BodyInit | undefined, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(60000) })
    const output = new Headers({ "Cache-Control": "no-store, no-transform", "X-Content-Type-Options": "nosniff", "Content-Type": upstream.headers.get("content-type") || "application/json" })
    for (const key of ["etag", "content-disposition"]) { const value = upstream.headers.get(key); if (value) output.set(key, value) }
    return new Response(upstream.body, { status: upstream.status, headers: output })
  } catch {
    return Response.json({ title: "Não foi possível confirmar o resultado. Consulte o contrato antes de repetir a operação" }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}

export async function contractWebhookProxy(request: Request, tenant: string) {
  if (!uuidPattern.test(tenant)) return new Response(null, { status: 404 })
  const secret = request.headers.get("x-avila-contract-secret")
  if (!secret || secret.length > 512) return new Response(null, { status: 403 })
  try {
    const reader = request.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    if (reader) for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 1_048_576) { await reader.cancel(); return new Response(null, { status: 413 }) }
      chunks.push(value)
    }
    const upstream = await fetch(`${erpConfiguration().api}/api/v1/webhooks/contracts/${tenant}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Avila-Contract-Secret": secret }, body: Buffer.concat(chunks), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(13000) })
    return new Response(null, { status: upstream.status, headers: { "Cache-Control": "no-store" } })
  } catch { return new Response(null, { status: 503 }) }
}
