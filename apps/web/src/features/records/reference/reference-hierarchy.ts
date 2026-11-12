export type ReferenceNode = { id: string; name: string; code?: string; parentId?: string | null; sortOrder?: number | null; status: string; direction?: string | null }
export type ReferenceOption = ReferenceNode & { path: string; depth: number; ancestorIds: string[]; available: boolean }
export type HierarchyEndpoint = "product-categories" | "financial-categories"
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function referenceHierarchy(rows: ReferenceNode[]): ReferenceOption[] {
  const nodes = new Map<string, ReferenceNode>()
  if (rows.length > 10_000) throw new Error("A lista de categorias excede o limite de consulta.")
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || !uuid.test(row.id) || typeof row.name !== "string" || !row.name.trim() || row.name.length > 200 || !["active", "archived"].includes(row.status)
      || row.parentId != null && (typeof row.parentId !== "string" || !uuid.test(row.parentId)) || row.sortOrder != null && (!Number.isSafeInteger(row.sortOrder) || row.sortOrder < 0 || row.sortOrder > 999999)) throw new Error("Não foi possível conferir os dados das categorias.")
    const key = row.id.toLowerCase()
    if (nodes.has(key)) throw new Error("A consulta retornou categorias repetidas. Atualize a lista.")
    nodes.set(key, row)
  }
  const resolved = new Map<string, ReferenceOption>()
  for (const key of nodes.keys()) {
    const path: ReferenceNode[] = []
    const visiting = new Set<string>()
    let cursor: string | null = key
    while (cursor && !resolved.has(cursor)) {
      if (visiting.has(cursor)) throw new Error("A hierarquia de categorias contém um ciclo. Confira a categoria superior.")
      const row = nodes.get(cursor)
      if (!row) throw new Error("Uma categoria superior não foi encontrada. Atualize a lista.")
      visiting.add(cursor); path.push(row)
      if (path.length > 64) throw new Error("A hierarquia excede a profundidade permitida.")
      cursor = row.parentId?.toLowerCase() || null
    }
    let parent = cursor ? resolved.get(cursor) : undefined
    for (const row of path.reverse()) {
      const ancestorIds = parent ? [...parent.ancestorIds, parent.id] : []
      if (ancestorIds.length >= 64) throw new Error("A hierarquia excede a profundidade permitida.")
      const option: ReferenceOption = { ...row, path: parent ? `${parent.path} / ${row.name}` : row.name, depth: ancestorIds.length, ancestorIds, available: row.status === "active" && (!parent || parent.available) }
      resolved.set(row.id.toLowerCase(), option); parent = option
    }
  }
  const children = new Map<string, ReferenceOption[]>()
  for (const row of resolved.values()) {
    const parent = row.parentId?.toLowerCase() || ""
    const siblings = children.get(parent) || []
    siblings.push(row); children.set(parent, siblings)
  }
  for (const siblings of children.values()) siblings.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id))
  const result: ReferenceOption[] = []
  const append = (parent: string) => { for (const row of children.get(parent) || []) { result.push(row); append(row.id.toLowerCase()) } }
  append("")
  return result
}

export function availableParents(options: ReferenceOption[], id?: string | null, direction?: string | null) {
  const excluded = id?.toLowerCase()
  return options.filter(row => row.available && (!excluded || row.id.toLowerCase() !== excluded && !row.ancestorIds.some(parent => parent.toLowerCase() === excluded)) && (!direction || row.direction === direction))
}

export async function loadReferenceHierarchy(endpoint: HierarchyEndpoint, tenant: string, signal: AbortSignal, request: (url: string, init: RequestInit) => Promise<Response>) {
  if (!["product-categories", "financial-categories"].includes(endpoint)) throw new Error("Consulta de categorias inválida.")
  const rows: ReferenceNode[] = []
  let total: number | undefined
  for (;;) {
    if (signal.aborted) throw new DOMException("Consulta cancelada", "AbortError")
    const response = await request(`/api/erp/${endpoint}?limit=100&offset=${rows.length}`, { cache: "no-store", signal, headers: { "X-Tenant-Id": tenant } })
    if (!response.ok) throw new Error("Categorias indisponíveis. O vínculo atual será preservado.")
    const page = await response.json()
    if (page.tenantId !== tenant) throw new Error("A empresa da sessão mudou. Reabra as categorias.")
    if (!Number.isSafeInteger(page.total) || page.total < 0 || page.total > 10_000 || !Array.isArray(page.data) || page.data.length > 100) throw new Error("Não foi possível conferir a lista completa de categorias.")
    const pageTotal: number = page.total
    if (total !== undefined && total !== pageTotal) throw new Error("As categorias mudaram durante a consulta. Atualize a lista.")
    total = pageTotal
    if (rows.length + page.data.length > pageTotal || !page.data.length && rows.length < pageTotal) throw new Error("Não foi possível carregar a lista completa de categorias.")
    rows.push(...page.data)
    if (rows.length === pageTotal) return referenceHierarchy(rows)
  }
}
