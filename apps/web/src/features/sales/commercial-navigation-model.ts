export type CommercialSelection = { productId: string; quantity: number }
export type CommercialTableQuery = { line: "imported" | "national"; q: string; offset: number; destinationState: string; taxpayer: boolean; items: CommercialSelection[] }
type TableLocation = Pick<CommercialTableQuery, "line" | "q" | "offset"> & Partial<Pick<CommercialTableQuery, "destinationState" | "taxpayer" | "items">>
export const commercialTablePageSize = 14
const states = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "))
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function readCommercialItems(value: string | null | undefined): CommercialSelection[] {
  if (!value || value.length > 4500) return []
  const entries = value.split(",")
  if (entries.length > 100) return []
  const seen = new Set<string>()
  const items: CommercialSelection[] = []
  for (const entry of entries) {
    const [id, quantity, extra] = entry.split(":")
    const productId = id.toLowerCase()
    if (!uuid.test(id) || extra !== undefined || !/^\d{1,7}$/.test(quantity || "") || Number(quantity) < 1 || Number(quantity) > 1_000_000 || seen.has(productId)) return []
    seen.add(productId)
    items.push({ productId, quantity: Number(quantity) })
  }
  return items
}

export function readCommercialTableQuery(params: Pick<URLSearchParams, "get">): CommercialTableQuery {
  const raw = params.get("offset") || "0"
  const offset = /^\d{1,6}$/.test(raw) ? Number(raw) : 0
  const destination = (params.get("destinationState") || "").toUpperCase()
  return { line: params.get("linha") === "national" ? "national" : "imported", q: (params.get("q") || "").trim().slice(0, 160), offset: Math.floor(offset / commercialTablePageSize) * commercialTablePageSize, destinationState: states.has(destination) ? destination : "", taxpayer: params.get("taxpayer") === "true", items: readCommercialItems(params.get("itens")) }
}

export function commercialTableHref(query: TableLocation) {
  const params = new URLSearchParams()
  if (query.line === "national") params.set("linha", query.line)
  if (query.q) params.set("q", query.q)
  if (query.offset) params.set("offset", String(query.offset))
  if (query.destinationState) params.set("destinationState", query.destinationState)
  if (query.taxpayer) params.set("taxpayer", "true")
  if (query.items?.length) params.set("itens", query.items.map(item => `${item.productId}:${item.quantity}`).join(","))
  return `/vendas/tabela-precos${params.size ? `?${params}` : ""}`
}

export function commercialSimulationHref(query: CommercialTableQuery, product?: string) {
  const params = new URLSearchParams({ linha: query.line })
  if (product) params.set("produto", product)
  else if (query.items.length) params.set("itens", query.items.map(item => `${item.productId}:${item.quantity}`).join(","))
  if (query.destinationState) params.set("destinationState", query.destinationState)
  params.set("taxpayer", String(query.taxpayer))
  params.set("returnTo", commercialTableHref(query))
  return `/vendas/simulador?${params}`
}

export function commercialTableReturn(value: string | undefined, line: string) {
  const fallback = commercialTableHref({ line: line === "national" ? "national" : "imported", q: "", offset: 0 })
  if (!value?.startsWith("/vendas/tabela-precos")) return fallback
  try {
    const url = new URL(value, "https://erp.local")
    if (url.origin !== "https://erp.local" || url.pathname !== "/vendas/tabela-precos") return fallback
    return commercialTableHref(readCommercialTableQuery(url.searchParams))
  } catch { return fallback }
}
