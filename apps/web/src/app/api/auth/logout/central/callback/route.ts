import { cookies } from "next/headers"
import { connection, NextResponse } from "next/server"
import { cookieName, cookieOptions, erpConfiguration } from "@/server/auth/erp-session"

/** Retorno validado pelo Auth: encerra qualquer resíduo local. */
export async function GET() {
  await connection()
  const config = erpConfiguration()
  const jar = await cookies()
  jar.set(cookieName("session"), "", cookieOptions(0))
  jar.set(cookieName("auth"), "", cookieOptions(0))
  return NextResponse.redirect(new URL("/entrar", config.origin), 303)
}
