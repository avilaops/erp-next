export type RegistryListKind = "party" | "staff" | "reference"
export type RegistryQuery = { q: string; status: string; role: string; offset: number; sortBy?: string; sortOrder?: "asc" | "desc" }
export const registryMaxOffset = 100_000
const roles = { party: ["customer", "supplier"], staff: ["employee", "seller"], reference: [] } as const

export const registrySortFields = { party: ["legalName", "taxId", "relationship", "contact", "status"], staff: ["code", "name", "jobTitle", "contact", "status"], reference: ["code", "name", "status"] } as const

export function parseRegistryQuery(params: Pick<URLSearchParams, "get">, kind: RegistryListKind, allowedSort: readonly string[] = registrySortFields[kind]): RegistryQuery {
  const q = (params.get("q") || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 160)
  const status = params.get("status") || ""
  const role = params.get("role") || ""
  const raw = params.get("offset") || "0"
  const offset = /^\d{1,7}$/.test(raw) && Number(raw) <= registryMaxOffset ? Math.floor(Number(raw) / 25) * 25 : 0
  const sortBy = params.get("sortBy") || ""
  const sortOrder = params.get("sortOrder")
  const sort = allowedSort.includes(sortBy) && (sortOrder === null || sortOrder === "asc" || sortOrder === "desc") ? { sortBy, sortOrder: (sortOrder || "asc") as "asc" | "desc" } : {}
  return { ...sort, q, status: ["active", "archived"].includes(status) ? status : "", role: (roles[kind] as readonly string[]).includes(role) ? role : "", offset }
}

export function registryQueryString(query: RegistryQuery) {
  const params = new URLSearchParams()
  if (query.q) params.set("q", query.q)
  if (query.status) params.set("status", query.status)
  if (query.role) params.set("role", query.role)
  if (query.offset) params.set("offset", String(query.offset))
  if (query.sortBy) { params.set("sortBy", query.sortBy); params.set("sortOrder", query.sortOrder || "asc") }
  return params.toString()
}
