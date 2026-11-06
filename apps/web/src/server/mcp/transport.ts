import "server-only"
import { erpConfiguration } from "@/server/auth/erp-session"

const paths = new Set(["/mcp", "/mcp/oauth/register", "/mcp/oauth/token", "/mcp/oauth/revoke", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server"])

export async function forwardMcp(request: Request, path: string) {
  if (!paths.has(path) || new URL(request.url).search) return Response.json({ error: "invalid_request" }, { status: 400 })
  try {
    const headers = new Headers()
    for (const key of ["authorization", "content-type", "accept", "origin", "mcp-protocol-version", "mcp-session-id"]) {
      const value = request.headers.get(key)
      if (value) headers.set(key, value)
    }
    const init: RequestInit & { duplex?: string } = { method: request.method, headers, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(125_000) }
    if (!["GET", "HEAD"].includes(request.method) && request.body) { init.body = request.body; init.duplex = "half" }
    const response = await fetch(`${erpConfiguration().api}${path}`, init)
    const forwarded = new Headers({ "Cache-Control": "no-store" })
    for (const key of ["content-type", "www-authenticate", "allow", "retry-after", "x-request-id", "mcp-protocol-version", "access-control-allow-origin", "access-control-allow-methods", "access-control-allow-headers", "access-control-expose-headers", "vary"]) {
      const value = response.headers.get(key)
      if (value) forwarded.set(key, value)
    }
    return new Response(response.body, { status: response.status, headers: forwarded })
  } catch { return Response.json({ error: "mcp_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }) }
}
