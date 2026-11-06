import "server-only"
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"
import { currentIdentitySession, erpConfiguration, seal, unseal, cookieOptions } from "@/server/auth/erp-session"

type Flow = { query: string; csrf: string; expiresAt: number; session?: string }
type Description = { client_name: string; redirect_uri: string; scope: string }
const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const escaped = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
const cookie = () => `${erpConfiguration().secure ? "__Host-" : ""}erp_mcp_consent`
const failure = (status: number) => Response.json({ error: status === 403 ? "consent_verification_failed" : "invalid_authorization_request" }, { status, headers: { "Cache-Control": "no-store" } })

async function describe(query: string): Promise<Description | null> {
  if (!query || query.length > 2048) return null
  const response = await fetch(`${erpConfiguration().api}/mcp/oauth/authorization-request?${query}`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) })
  if (!response.ok) return null
  const value = await response.json()
  if (typeof value.client_name !== "string" || typeof value.redirect_uri !== "string" || typeof value.scope !== "string") return null
  return value
}

export async function showConsent(request: Request) {
  try {
    const config = erpConfiguration()
    const jar = await cookies()
    const incoming = new URL(request.url).searchParams
    let flow = incoming.get("resume") === "1" ? unseal<Flow>(jar.get(cookie())?.value || "", "mcp-consent") : null
    if (incoming.get("resume") === "1" && (!flow || flow.expiresAt <= Date.now())) return failure(400)
    if (!flow) flow = { query: incoming.toString(), csrf: randomBytes(32).toString("base64url"), expiresAt: Date.now() + 600_000 }
    const description = await describe(flow.query)
    if (!description) return failure(400)
    const session = await currentIdentitySession()
    if (session) flow.session = hash(session.accessToken)
    const sealed = seal(flow, "mcp-consent")
    if (sealed.length > 3800) return failure(400)
    jar.set(cookie(), sealed, cookieOptions(600))
    if (!session) {
      const location = new URL("/api/auth/login", config.origin)
      location.searchParams.set("returnTo", "/mcp/oauth/authorize?resume=1")
      return new Response(null, { status: 303, headers: { Location: location.href, "Cache-Control": "no-store" } })
    }
    const writes = description.scope.split(" ").includes("erp.write")
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Autorizar MCP — ERP Ávila</title><style>body{font:17px/1.55 system-ui,sans-serif;background:#f4f5f7;color:#17202b;margin:0;padding:24px}main{max-width:620px;margin:8vh auto;background:white;padding:32px;border-radius:16px}h1{font-size:26px;line-height:1.2}p{overflow-wrap:anywhere}button{font:inherit;padding:12px 20px;border:1px solid #394b61;border-radius:8px;cursor:pointer}button[value=allow]{background:#17364f;color:white}form{display:flex;gap:12px;flex-wrap:wrap}#error{color:#a31d1d}</style></head><body><main><h1>Autorizar conexão com o ERP</h1><p><strong>${escaped(description.client_name)}</strong> solicita acesso ao ERP.</p><p>Retorno ao cliente: ${escaped(description.redirect_uri)}</p><p>Permissões solicitadas: ${writes ? "consultar, cadastrar e alterar dados" : "consultar dados"} nas empresas às quais sua conta tem acesso. As permissões e regras do ERP continuam valendo.</p><p>Autorize somente se você iniciou esta conexão. Você poderá revogar a conexão pelo cliente MCP.</p><form method="post" action="/mcp/oauth/authorize"><input type="hidden" name="csrf" value="${escaped(flow.csrf)}"><button type="submit" name="decision" value="allow">Autorizar</button><button type="submit" name="decision" value="deny">Recusar</button></form><p id="error" role="alert"></p></main><script>document.querySelector('form').addEventListener('submit',async function(event){event.preventDefault();const button=event.submitter;const body=new URLSearchParams(new FormData(this));body.set('decision',button.value);button.disabled=true;try{const response=await fetch(this.action,{method:'POST',headers:{'Accept':'application/json'},body});const result=await response.json();if(!response.ok||typeof result.redirect_uri!=='string')throw new Error();location.assign(result.redirect_uri)}catch{document.querySelector('#error').textContent='Não foi possível autorizar. Reabra a conexão para tentar novamente.';button.disabled=false}})</script></body></html>`
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "same-origin" } })
  } catch { return failure(503) }
}

export async function decideConsent(request: Request) {
  try {
    const config = erpConfiguration()
    if (request.headers.get("origin") !== config.origin) return failure(403)
    if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return failure(415)
    const reader = request.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 4096) { await reader.cancel(); return failure(413) } chunks.push(value) }
    const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"))
    const jar = await cookies()
    const flow = unseal<Flow>(jar.get(cookie())?.value || "", "mcp-consent")
    const session = await currentIdentitySession()
    if (!flow || !session || !Number.isFinite(flow.expiresAt) || flow.expiresAt <= Date.now() || flow.session !== hash(session.accessToken) || typeof flow.csrf !== "string" || !timingSafeEqual(Buffer.from(hash(flow.csrf)), Buffer.from(hash(form.get("csrf") || "")))) return failure(403)
    const decision = form.get("decision")
    if (!["allow", "deny"].includes(decision || "")) return failure(400)
    const description = await describe(flow.query)
    if (!description) return failure(400)
    jar.set(cookie(), "", cookieOptions(0))
    if (decision === "deny") {
      const target = new URL(description.redirect_uri)
      target.searchParams.set("error", "access_denied")
      const state = new URLSearchParams(flow.query).get("state")
      if (state !== null) target.searchParams.set("state", state)
      return Response.json({ redirect_uri: target.href }, { headers: { "Cache-Control": "no-store" } })
    }
    const response = await fetch(`${config.api}/mcp/oauth/grant`, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new URLSearchParams(flow.query))) })
    if (!response.ok) return failure(response.status)
    const result = await response.json()
    if (typeof result.redirect_uri !== "string") return failure(503)
    const target = new URL(result.redirect_uri)
    const expected = new URL(description.redirect_uri)
    if (target.origin !== expected.origin || target.pathname !== expected.pathname) return failure(503)
    return Response.json({ redirect_uri: target.href }, { headers: { "Cache-Control": "no-store" } })
  } catch { return failure(503) }
}
