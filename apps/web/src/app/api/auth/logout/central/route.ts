import { cookies } from "next/headers"
import { connection, NextResponse } from "next/server"
import { cookieName, cookieOptions, erpConfiguration } from "@/server/auth/erp-session"

/** Entra no logout RP-initiated do Auth e volta para limpar a sessão local. */
export async function GET() {
  await connection()
  const config = erpConfiguration()
  const jar = await cookies()
  const location = new URL(`${config.issuer}/api/auth/logout`)
  if (config.clientId) location.searchParams.set("client_id", config.clientId)
  location.searchParams.set("post_logout_redirect_uri", `${config.origin}/api/auth/logout/central/callback`)
  jar.set(cookieName("session"), "", cookieOptions(0))
  jar.set(cookieName("auth"), "", cookieOptions(0))
  return NextResponse.redirect(location, 303)
}
