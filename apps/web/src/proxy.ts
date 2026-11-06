import { NextResponse, type NextRequest } from "next/server"
import { cookieName, identityFromCookie } from "@/server/auth/erp-session"
import { accessHref, recoveryDestination } from "@/lib/return-to"

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  if (pathname === "/mcp" || pathname.startsWith("/mcp/") || ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server"].includes(pathname)) return NextResponse.next()
  if (pathname === "/_next/image") {
    const source = request.nextUrl.searchParams.get("url") || ""
    if (!/^\/(?!\/)[^#'"\\\u0000-\u001f]*$/.test(source)) {
      return NextResponse.json({ title: "Parâmetro de imagem inválido" }, { status: 400 })
    }
    return NextResponse.next()
  }
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
  matcher: ["/_next/image", "/((?!api/|_next/|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|svg|webp|avif|ico|woff2?)$).*)"],
}
