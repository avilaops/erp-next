import { createHash, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { authEndpoints, cookieName, cookieOptions, erpConfiguration, seal, unseal, uuidPattern } from "@/server/auth/erp-session"
import { accessHref, safeReturnTo } from "@/lib/return-to"

type CompanyDirectory = { data: { id: string; legalName: string; tradeName?: string | null; status: string }[]; platformAdministrator: boolean }

function isCompanyDirectory(value: unknown): value is CompanyDirectory {
  if (!value || typeof value !== "object") return false
  const body = value as { data?: unknown; platformAdministrator?: unknown }
  return typeof body.platformAdministrator === "boolean"
    && Array.isArray(body.data)
    && body.data.every(item => {
      if (!item || typeof item !== "object") return false
      const company = item as Record<string, unknown>
      return typeof company.id === "string"
        && uuidPattern.test(company.id)
        && typeof company.legalName === "string"
        && (company.tradeName === undefined || company.tradeName === null || typeof company.tradeName === "string")
        && typeof company.status === "string"
    })
}

function callbackFailure(request: Request, origin: string | undefined, reason: "restart" | "denied" | "unavailable", status: number, destination: string) {
  const title = reason === "restart" ? "Sessão de autenticação inválida ou expirada" : reason === "denied" ? "Não foi possível verificar seu acesso" : "Não foi possível concluir o acesso. Tente entrar novamente"
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }
  if (!origin || !request.headers.get("accept")?.includes("text/html")) return Response.json({ title }, { status, headers })
  const location = new URL(accessHref("/entrar", destination), origin)
  location.searchParams.set("erro", reason)
  const response = NextResponse.redirect(location, 303)
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value)
  return response
}

export async function GET(request: Request) {
  let origin: string | undefined
  let returnTo = safeReturnTo(null)
  try {
    const config = erpConfiguration()
    origin = config.origin
    const jar = await cookies()
    const flow = unseal<{ state: string; verifier: string; tenantId: string | null; returnTo?: string; expiresAt: number }>(jar.get(cookieName("auth"))?.value || "", "erp-auth")
    returnTo = safeReturnTo(flow?.returnTo)
    jar.set(cookieName("auth"), "", cookieOptions(0))
    const params = new URL(request.url).searchParams
    const state = params.get("state") || ""
    const code = params.get("code") || ""
    if (!flow || flow.expiresAt <= Date.now() || !Number.isFinite(flow.expiresAt) || (flow.tenantId !== null && (typeof flow.tenantId !== "string" || !uuidPattern.test(flow.tenantId))) || typeof flow.state !== "string" || typeof flow.verifier !== "string" || !code || code.length > 4096 || !timingSafeEqual(createHash("sha256").update(flow.state).digest(), createHash("sha256").update(state).digest()) || !config.clientId || !config.clientSecret) {
      return callbackFailure(request, origin, "restart", 400, returnTo)
    }
    const endpoints = await authEndpoints()
    const tokenResponse = await fetch(endpoints.token, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000), headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString("base64")}` }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${config.origin}/api/auth/callback`, code_verifier: flow.verifier }) })
    if (!tokenResponse.ok) throw new Error("Token recusado")
    const token = await tokenResponse.json()
    if (typeof token.access_token !== "string" || token.token_type?.toLowerCase() !== "bearer" || !Number.isFinite(token.expires_in) || token.expires_in <= 0) throw new Error("Resposta do Auth inválida")
    // The API verifies Auth userinfo; company discovery never trusts browser claims.
    let tenantId = flow.tenantId
    let destination = safeReturnTo(flow.returnTo)
    const access = await fetch(`${config.api}/api/v1/companies`, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${token.access_token}` } })
    if (!access.ok) return callbackFailure(request, origin, access.status === 401 || access.status === 403 ? "denied" : "unavailable", access.status === 401 || access.status === 403 ? access.status : 503, returnTo)
    const companies = await access.json()
    if (!isCompanyDirectory(companies)) throw new Error("Lista de empresas inválida")
    if (companies.platformAdministrator === true) tenantId = null
    else if (tenantId) {
      const selectedCompany = companies.data.find(item => item.id === tenantId)
      if (!selectedCompany || selectedCompany.status !== "active") return callbackFailure(request, origin, "denied", 403, returnTo)
    }
    if (!tenantId) {
      if (companies.data.length === 1 && companies.platformAdministrator !== true && companies.data[0].status === "active") tenantId = companies.data[0].id
      else destination = companies.data.length === 0 && companies.platformAdministrator !== true ? "/cadastro/empresa?" + new URLSearchParams({ returnTo: destination }) : accessHref("/empresas", destination)
    }
    const maxAge = Math.min(3600, Math.floor(token.expires_in))
    const session = seal({ accessToken: token.access_token, tenantId, expiresAt: Date.now() + maxAge * 1000 }, "erp-session")
    if (session.length > 3800) throw new Error("Credencial excede o limite de sessão")
    jar.set(cookieName("session"), session, cookieOptions(maxAge))
    const response = NextResponse.redirect(new URL(destination, config.origin))
    response.headers.set("Cache-Control", "no-store")
    response.headers.set("Referrer-Policy", "no-referrer")
    return response
  } catch { return callbackFailure(request, origin, "unavailable", 503, returnTo) }
}
