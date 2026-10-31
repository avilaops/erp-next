import { currentIdentitySession, currentSession, erpConfiguration } from "@/lib/erp-session"

export async function forwardErp(request: Request, resource: string) {
  const auditResource = resource === "/audit"
  const invitationResource = /^\/invitations(?:\/[a-f0-9-]{36}\/(?:resend|revoke))?$/i.test(resource)
  const referenceCollection = /^\/(?:product-categories|financial-categories|financial-accounts|payment-methods)$/i.test(resource)
  const referenceResource = /^\/(?:product-categories|financial-categories|financial-accounts|payment-methods)(?:\/[a-f0-9-]{36})?$/i.test(resource)
  const serviceKeyResource = /^\/integrations\/service-keys(?:\/[a-f0-9-]{36})?$/i.test(resource)
  const purchaseCollection = /^\/(?:purchase-orders|payables)$|^\/purchase-orders\/[a-f0-9-]{36}\/receipts$/i.test(resource)
  const purchaseResource = purchaseCollection || /^\/(?:purchase-orders|purchase-receipts|payables)\/[a-f0-9-]{36}$|^\/purchase-orders\/[a-f0-9-]{36}\/(?:confirm|cancel|close)$|^\/payables\/[a-f0-9-]{36}\/(?:payments|reverse-payment)$/i.test(resource)
  if (!auditResource && !invitationResource && !referenceResource && !serviceKeyResource && !purchaseResource && !/^\/(?:me|company|companies|financial-settings|preferences|staff|users|roles|permissions|products|stock|parties|orders|receivables)$|^\/(?:users|roles|products|parties|staff|orders|receivables)\/[a-f0-9-]{36}$|^\/stock\/movements$|^\/orders\/[a-f0-9-]{36}\/(?:confirm|cancel|complete)$|^\/receivables\/[a-f0-9-]{36}\/(?:payments|reverse-payment)$/i.test(resource)) return Response.json({ title: "Recurso inválido" }, { status: 400 })
  try {
    const config = erpConfiguration()
    const session = resource === "/companies" ? await currentIdentitySession() : await currentSession()
    if (!session) return Response.json({ title: "Entre para acessar os dados da empresa" }, { status: 401, headers: { "Cache-Control": "no-store" } })
    if (request.method !== "GET" && request.headers.get("origin") !== config.origin) return Response.json({ title: "Origem não autorizada" }, { status: 403 })
    if (request.method !== "GET" && resource !== "/companies" && request.headers.get("x-tenant-id") !== session.tenantId) return Response.json({ title: "A empresa da sessão mudou. Sua edição foi preservada" }, { status: 409 })
    const headers = new Headers({ Authorization: `Bearer ${session.accessToken}`, ...(session.tenantId && resource !== "/companies" ? { "X-Tenant-Id": session.tenantId } : {}), Accept: "application/json" })
    let body: string | undefined
    if (request.method === "PUT" || request.method === "POST") {
      if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ title: "Envie JSON" }, { status: 415 })
      const reader = request.body?.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      const bodyLimit = /^\/products(?:\/[a-f0-9-]{36})?$/i.test(resource) ? 400_000 : 65_536
      if (reader) for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > bodyLimit) { await reader.cancel(); return Response.json({ title: "Cadastro muito grande" }, { status: 413 }) }
        chunks.push(value)
      }
      body = Buffer.concat(chunks).toString("utf8")
      headers.set("Content-Type", "application/json")
    }
    const etag = request.headers.get("if-match")
    if (etag) headers.set("If-Match", etag)
    const commandKey = request.headers.get("idempotency-key")
    if (commandKey) headers.set("Idempotency-Key", commandKey)
    const upstream = new URL(`${config.api}/api/v1${resource}`)
    if (auditResource || referenceCollection || purchaseResource || ["/staff", "/products", "/stock", "/stock/movements", "/parties", "/orders", "/receivables"].includes(resource)) {
      const query = new URL(request.url).searchParams
      const allowed = auditResource ? ["q", "action", "entity", "startDate", "endDate", "before"] : purchaseResource ? purchaseCollection ? ["offset", "limit"] : [] : resource === "/stock/movements" ? ["productId", "offset", "limit"] : ["/parties", "/staff"].includes(resource) ? ["q", "status", "role", "offset", "limit"] : ["/orders", "/receivables"].includes(resource) ? ["offset", "limit"] : ["q", "status", "offset", "limit"]
      for (const [key, value] of query) {
        if (!allowed.includes(key) || query.getAll(key).length !== 1) return Response.json({ title: "Filtro inválido" }, { status: 400 })
        upstream.searchParams.set(key, value)
      }
    }
    const response = await fetch(upstream, { method: request.method, headers, body, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(invitationResource ? 20000 : 10000) })
    // ETag is the backend revision used by If-Match; proxy encoding must not rewrite it.
    const output = new Headers({ "Cache-Control": "no-store, no-transform", "Content-Type": response.headers.get("content-type") || "application/json" })
    for (const name of ["etag", "x-request-id", "idempotency-replayed"]) { const value = response.headers.get(name); if (value) output.set(name, value) }
    return new Response(response.status === 204 ? null : await response.text(), { status: response.status, headers: output })
  } catch { return Response.json({ title: "Serviço do ERP indisponível. Sua edição foi preservada" }, { status: 503, headers: { "Cache-Control": "no-store" } }) }
}
