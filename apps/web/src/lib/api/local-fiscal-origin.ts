/** Pure origin selection; callers supply configuration and never pass credentials. */
export function fiscalApiOrigin(resource: string, defaultOrigin: string, override: string | undefined, environment: string | undefined): string {
  if (environment !== "development" || !override || !/^\/fiscal\/(?:nfe(?:\/|$)|issued-nfes$|outgoing-imports(?:\/|$)|readiness$|config$|certificate$|order-preparations\/|ibpt(?:\/|$))/.test(resource)) return defaultOrigin
  const url = new URL(override)
  if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Destino fiscal local inválido")
  return url.origin
}
