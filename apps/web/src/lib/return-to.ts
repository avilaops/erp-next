const fallback = "/preferencias/empresa/dados"

/** Only application pages may be used as a post-authentication destination. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length > 1024 || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return fallback
  try {
    const url = new URL(value, "https://erp.invalid")
    const pathname = decodeURIComponent(url.pathname)
    if (url.origin !== "https://erp.invalid" || pathname.startsWith("//") || /[\\\u0000-\u0020\u007f%]/.test(pathname) || /^\/(?:api|_next|entrar|criar-conta)(?:\/|$)/.test(pathname)) return fallback
    const destination = url.pathname + url.search + url.hash
    if (["/empresas", "/cadastro/empresa"].includes(url.pathname)) return fallback
    return destination.length <= 1024 ? destination : fallback
  } catch { return fallback }
}

export function accessHref(page: "/entrar" | "/empresas", destination: unknown) {
  return page + "?" + new URLSearchParams({ returnTo: safeReturnTo(destination) })
}

/** Access pages carry the original destination instead of becoming a return loop. */
export function recoveryDestination(pathname: string, params: Pick<URLSearchParams, "get" | "toString">) {
  if (pathname === "/empresas" || pathname === "/cadastro/empresa") return safeReturnTo(params.get("returnTo"))
  const query = params.toString()
  return safeReturnTo(pathname + (query ? "?" + query : ""))
}
