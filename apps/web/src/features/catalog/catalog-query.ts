export type CatalogQuery = { q: string; status: string; offset: number }
export const catalogMaxOffset = 100_000

export function parseCatalogQuery(params: Pick<URLSearchParams, "get">): CatalogQuery {
  const q = (params.get("q") || "").trim().slice(0, 160)
  const rawStatus = params.get("status")
  const status = rawStatus === "active" || rawStatus === "archived" ? rawStatus : ""
  const rawOffset = params.get("offset") || "0"
  const number = /^\d{1,7}$/.test(rawOffset) ? Number(rawOffset) : 0
  const offset = number <= catalogMaxOffset ? Math.floor(number / 25) * 25 : 0
  return { q, status, offset }
}

export function catalogQueryString(query: CatalogQuery) {
  const params = new URLSearchParams()
  if (query.q) params.set("q", query.q)
  if (query.status) params.set("status", query.status)
  if (query.offset) params.set("offset", String(query.offset))
  return params.toString()
}
