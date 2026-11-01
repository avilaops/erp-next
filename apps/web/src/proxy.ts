import { NextResponse, type NextRequest } from "next/server"
import { cookieName, identityFromCookie } from "@/server/auth/erp-session"
import { accessHref, recoveryDestination } from "@/lib/return-to"

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const publicPage = pathname === "/entrar" || pathname === "/criar-conta"
  let authenticated = false
  try { authenticated = !!identityFromCookie(request.cookies.get(cookieName("session"))?.value || "") }
  catch { /* Missing configuration must still leave the entry page available. */ }
  if (!publicPage && !authenticated) {
    const response = NextResponse.redirect(new URL(accessHref("/entrar", recoveryDestination(pathname, request.nextUrl.searchParams)), request.url))
    response.headers.set("Cache-Control", "private, no-store")
    return response
  }
  const headers = new Headers(request.headers)
  headers.set("x-erp-path", pathname)
  const response = NextResponse.next({ request: { headers } })
  response.headers.set("Cache-Control", "private, no-store")
  return response
}

export const config = {
  matcher: ["/((?!api/|_next/|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|svg|webp|avif|ico|woff2?)$).*)"],
}
