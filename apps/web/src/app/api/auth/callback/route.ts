import { createHash, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { authEndpoints, cookieName, cookieOptions, erpConfiguration, seal, unseal, uuidPattern } from "@/lib/erp-session"
import { accessHref, safeReturnTo } from "@/lib/return-to"

export async function GET(request: Request) {
  try {
    const config = erpConfiguration()
    const jar = await cookies()
    const flow = unseal<{ state: string; verifier: string; tenantId: string | null; returnTo?: string; expiresAt: number }>(jar.get(cookieName("auth"))?.value || "", "erp-auth")
    jar.set(cookieName("auth"), "", cookieOptions(0))
    const params = new URL(request.url).searchParams
    const state = params.get("state") || ""
    const code = params.get("code") || ""
    if (!flow || flow.expiresAt <= Date.now() || !Number.isFinite(flow.expiresAt) || (flow.tenantId !== null && (typeof flow.tenantId !== "string" || !uuidPattern.test(flow.tenantId))) || typeof flow.state !== "string" || typeof flow.verifier !== "string" || !code || code.length > 4096 || !timingSafeEqual(createHash("sha256").update(flow.state).digest(), createHash("sha256").update(state).digest()) || !config.clientId || !config.clientSecret) {
      return Response.json({ title: "Sessão de autenticação inválida ou expirada" }, { status: 400, headers: { "Cache-Control": "no-store" } })
    }
    const endpoints = await authEndpoints()
    const tokenResponse = await fetch(endpoints.token, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000), headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString("base64")}` }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${config.origin}/api/auth/callback`, code_verifier: flow.verifier }) })
    if (!tokenResponse.ok) throw new Error("Token recusado")
    const token = await tokenResponse.json()
    if (typeof token.access_token !== "string" || token.token_type?.toLowerCase() !== "bearer" || !Number.isFinite(token.expires_in) || token.expires_in <= 0) throw new Error("Resposta do Auth inválida")
    // The API verifies Auth userinfo; company discovery never trusts browser claims.
    let tenantId = flow.tenantId
    let destination = safeReturnTo(flow.returnTo)
    const access = await fetch(`${config.api}/api/v1/${tenantId ? "me" : "companies"}`, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${token.access_token}`, ...(tenantId ? { "X-Tenant-Id": tenantId } : {}) } })
    if (!access.ok) return Response.json({ title: "Não foi possível verificar seu acesso" }, { status: access.status === 401 || access.status === 403 ? access.status : 503, headers: { "Cache-Control": "no-store" } })
    if (!tenantId) {
      const companies = await access.json()
      if (!Array.isArray(companies.data) || companies.data.some((item: { id?: unknown }) => typeof item?.id !== "string" || !uuidPattern.test(item.id))) throw new Error("Lista de empresas inválida")
      if (companies.data.length === 1) tenantId = companies.data[0].id
      else destination = companies.data.length === 0 ? "/cadastro/empresa?" + new URLSearchParams({ returnTo: destination }) : accessHref("/empresas", destination)
    }
    const maxAge = Math.min(3600, Math.floor(token.expires_in))
    const session = seal({ accessToken: token.access_token, tenantId, expiresAt: Date.now() + maxAge * 1000 }, "erp-session")
    if (session.length > 3800) throw new Error("Credencial excede o limite de sessão")
    jar.set(cookieName("session"), session, cookieOptions(maxAge))
    const response = NextResponse.redirect(new URL(destination, config.origin))
    response.headers.set("Cache-Control", "no-store")
    response.headers.set("Referrer-Policy", "no-referrer")
    return response
  } catch { return Response.json({ title: "Não foi possível concluir o acesso. Tente entrar novamente" }, { status: 503, headers: { "Cache-Control": "no-store" } }) }
}
