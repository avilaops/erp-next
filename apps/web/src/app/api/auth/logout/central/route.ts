import { cookies } from "next/headers"
import { connection, NextResponse } from "next/server"
import { authEndpoints, cookieName, cookieOptions, erpConfiguration, seal, validLogoutFlow } from "@/server/auth/erp-session"

/** Continua somente a saída iniciada pelo POST de mesma origem. */
export async function GET() {
  await connection()
  try {
    const config = erpConfiguration()
    const jar = await cookies()
    if (!validLogoutFlow(jar.get(cookieName("logout"))?.value || "", "start") || jar.get(cookieName("session"))?.value) {
      return Response.json({ title: "Tentativa de saída inválida ou expirada" }, { status: 403, headers: { "Cache-Control": "no-store" } })
    }
    const { logout } = await authEndpoints()
    if (!logout || !config.clientId) throw new Error("Saída central não configurada")
    const location = new URL(logout)
    location.searchParams.set("client_id", config.clientId)
    location.searchParams.set("post_logout_redirect_uri", `${config.origin}/api/auth/logout/central/callback`)
    jar.set(cookieName("logout"), seal({ phase: "callback", expiresAt: Date.now() + 120_000 }, "erp-logout"), cookieOptions(120))
    const response = NextResponse.redirect(location, 303)
    response.headers.set("Cache-Control", "no-store")
    return response
  } catch {
    return Response.json({ title: "A sessão local foi encerrada, mas não foi possível confirmar a saída do Ávila Auth" }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}
