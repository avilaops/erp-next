import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { cookieName, cookieOptions, erpConfiguration } from "@/lib/erp-session"

export async function POST(request: Request) {
  try {
    const config = erpConfiguration()
    if (request.headers.get("origin") !== config.origin) return Response.json({ title: "Origem não autorizada" }, { status: 403 })
    const jar = await cookies()
    jar.set(cookieName("session"), "", cookieOptions(0))
    jar.set(cookieName("auth"), "", cookieOptions(0))
    const response = NextResponse.redirect(new URL("/entrar", config.origin), 303)
    response.headers.set("Cache-Control", "no-store")
    return response
  } catch { return Response.json({ title: "Não foi possível encerrar a sessão local" }, { status: 503 }) }
}
