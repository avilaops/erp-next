export type CatalogQuery = { q: string; status: string; offset: number; categoryId?: string; sortBy?: string; sortOrder?: "asc" | "desc" }
export const catalogMaxOffset = 100_000

export function catalogReturnHref(value: string | null) {
  if (!value?.startsWith("/cadastros/produtos?")) return "/cadastros/produtos"
  try {
    const url = new URL(value, "https://erp.local")
    return url.origin === "https://erp.local" && url.pathname === "/cadastros/produtos" ? url.pathname + url.search : "/cadastros/produtos"
  } catch { return "/cadastros/produtos" }
}

export function parseCatalogQuery(params: Pick<URLSearchParams, "get">, pageSize = 25): CatalogQuery {
  const q = (params.get("q") || "").trim().slice(0, 160)
  const rawStatus = params.get("status")
  const status = rawStatus === "active" || rawStatus === "archived" ? rawStatus : ""
  const rawOffset = params.get("offset") || "0"
  const number = /^\d{1,7}$/.test(rawOffset) ? Number(rawOffset) : 0
  const size = [10, 25, 50, 100].includes(pageSize) ? pageSize : 25
  const offset = number <= catalogMaxOffset ? Math.floor(number / size) * size : 0
  const categoryId = params.get("category_id") || ""
  const sortBy = params.get("sortBy") || ""
  const sortOrder = params.get("sortOrder")
  const sort = ["name", "sku", "unit", "price", "status"].includes(sortBy) && (sortOrder === null || sortOrder === "asc" || sortOrder === "desc") ? { sortBy, sortOrder: (sortOrder || "asc") as "asc" | "desc" } : {}
  return { q, status, offset, ...sort, ...(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(categoryId) ? { categoryId } : {}) }
}

export function catalogQueryString(query: CatalogQuery) {
  const params = new URLSearchParams()
  if (query.q) params.set("q", query.q)
  if (query.status) params.set("status", query.status)
  if (query.categoryId) params.set("category_id", query.categoryId)
  if (query.offset) params.set("offset", String(query.offset))
  if (query.sortBy) { params.set("sortBy", query.sortBy); params.set("sortOrder", query.sortOrder || "asc") }
  return params.toString()
}
