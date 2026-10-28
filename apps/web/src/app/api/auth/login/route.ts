import { createHash, randomBytes } from "node:crypto"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { authEndpoints, cookieName, cookieOptions, erpConfiguration, seal, uuidPattern } from "@/lib/erp-session"

export async function GET(request: Request) {
  try {
    const config = erpConfiguration()
    const tenantId = new URL(request.url).searchParams.get("tenant") || process.env.ERP_DEFAULT_TENANT_ID || ""
    if (!uuidPattern.test(tenantId)) return Response.json({ title: "Selecione uma empresa válida" }, { status: 400 })
    if (!config.clientId || !config.clientSecret) return Response.json({ title: "Acesso corporativo não configurado neste ambiente" }, { status: 503 })
    const endpoints = await authEndpoints()
    const state = randomBytes(32).toString("base64url")
    const verifier = randomBytes(32).toString("base64url")
    const location = new URL(endpoints.authorization)
    location.search = new URLSearchParams({ response_type: "code", client_id: config.clientId, redirect_uri: `${config.origin}/api/auth/callback`, scope: "openid profile email", state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString()
    const jar = await cookies()
    jar.set(cookieName("auth"), seal({ state, verifier, tenantId, expiresAt: Date.now() + 600_000 }, "erp-auth"), cookieOptions(600))
    const response = NextResponse.redirect(location)
    response.headers.set("Cache-Control", "no-store")
    return response
  } catch { return Response.json({ title: "Não foi possível iniciar a autenticação" }, { status: 503, headers: { "Cache-Control": "no-store" } }) }
}
