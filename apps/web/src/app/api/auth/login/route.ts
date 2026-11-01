import { createHash, randomBytes } from "node:crypto"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { authEndpoints, cookieName, cookieOptions, erpConfiguration, seal, uuidPattern } from "@/server/auth/erp-session"
import { safeReturnTo } from "@/lib/return-to"

export async function GET(request: Request) {
  try {
    const config = erpConfiguration()
    const parameters = new URL(request.url).searchParams
    const tenantId = parameters.get("tenant") || ""
    if (tenantId && !uuidPattern.test(tenantId)) return Response.json({ title: "Selecione uma empresa válida" }, { status: 400 })
    if (!config.clientId || !config.clientSecret) return Response.json({ title: "O login do ERP ainda não foi configurado neste ambiente" }, { status: 503, headers: { "Cache-Control": "no-store" } })
    const endpoints = await authEndpoints()
    const state = randomBytes(32).toString("base64url")
    const verifier = randomBytes(32).toString("base64url")
    const location = new URL(endpoints.authorization)
    location.search = new URLSearchParams({ response_type: "code", client_id: config.clientId, redirect_uri: `${config.origin}/api/auth/callback`, scope: "openid profile email", state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString()
    const jar = await cookies()
    jar.set(cookieName("auth"), seal({ state, verifier, tenantId: tenantId || null, returnTo: safeReturnTo(parameters.get("returnTo")), expiresAt: Date.now() + 600_000 }, "erp-auth"), cookieOptions(600))
    const destination = parameters.get("intent") === "signup" ? new URL("/criar", config.issuer) : location
    if (parameters.get("intent") === "signup") destination.searchParams.set("returnTo", `${location.pathname}${location.search}`)
    const response = NextResponse.redirect(destination)
    response.headers.set("Cache-Control", "no-store")
    return response
  } catch { return Response.json({ title: "Não foi possível iniciar a autenticação" }, { status: 503, headers: { "Cache-Control": "no-store" } }) }
}
