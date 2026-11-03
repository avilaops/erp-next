import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { cookieName, cookieOptions, erpConfiguration, seal } from "@/server/auth/erp-session"

export async function POST(request: Request) {
  try {
    const config = erpConfiguration()
    if (request.headers.get("origin") !== config.origin) return Response.json({ title: "Origem não autorizada" }, { status: 403 })
    const jar = await cookies()
    jar.set(cookieName("session"), "", cookieOptions(0))
    jar.set(cookieName("auth"), "", cookieOptions(0))
    jar.set(cookieName("logout"), seal({ phase: "start", expiresAt: Date.now() + 120_000 }, "erp-logout"), cookieOptions(120))
    const response = NextResponse.redirect(new URL("/api/auth/logout/central", config.origin), 303)
    response.headers.set("Cache-Control", "no-store")
    return response
  } catch { return Response.json({ title: "Não foi possível encerrar a sessão local" }, { status: 503 }) }
}
