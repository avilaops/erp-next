import "server-only"

import { currentSession, erpConfiguration } from "@/server/auth/erp-session"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const allowedQuery = new Set(["q", "status", "limit", "offset"])

export async function forwardPosting(request: Request, resource = "/logistics/postings") {
  const session = await currentSession()
  if (!session) return Response.json({ title: "Entre para acessar os dados da empresa" }, { status: 401, headers: { "Cache-Control": "no-store" } })
  const config = erpConfiguration()
  if (request.method !== "GET" && request.headers.get("origin") !== config.origin) return Response.json({ title: "Origem não autorizada" }, { status: 403 })
  if (request.method !== "GET" && request.headers.get("x-tenant-id") !== session.tenantId) return Response.json({ title: "A empresa da sessão mudou. Sua edição foi preservada" }, { status: 409 })
  const url = new URL(request.url)
  const upstream = new URL(`${config.api}/api/v1${resource}`)
  for (const [key, value] of url.searchParams) {
    if (!allowedQuery.has(key) || url.searchParams.getAll(key).length !== 1) return Response.json({ title: "Filtro inválido" }, { status: 400 })
    upstream.searchParams.set(key, value)
  }
  const headers = new Headers({ Authorization: `Bearer ${session.accessToken}`, Accept: "application/json" })
  if (session.tenantId) headers.set("X-Tenant-Id", session.tenantId)
  for (const name of ["content-type", "idempotency-key", "if-match"]) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  let body: string | undefined
  if (request.method === "POST") {
    if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ title: "Envie JSON" }, { status: 415 })
    body = await request.text()
    if (body.length > 65_536) return Response.json({ title: "Cadastro muito grande" }, { status: 413 })
  }
  try {
    const response = await fetch(upstream, { method: request.method, headers, body, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) })
    const output = new Headers({ "Cache-Control": "no-store, no-transform", "Content-Type": response.headers.get("content-type") || "application/json" })
    for (const name of ["etag", "x-request-id", "idempotency-replayed"]) {
      const value = response.headers.get(name)
      if (value) output.set(name, value)
    }
    return new Response(response.status === 204 ? null : await response.text(), { status: response.status, headers: output })
  } catch {
    return Response.json({ title: "Serviço do ERP indisponível. Sua edição foi preservada" }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}

export const GET = (request: Request) => forwardPosting(request)
export const POST = (request: Request) => forwardPosting(request)

export function validPostingId(id: string) {
  return uuid.test(id)
}
