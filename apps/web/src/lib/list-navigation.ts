const listRoute = /^\/(?:cadastros\/[^/]+|estoque\/depositos|vendas\/(?:pedidos|propostas|funil)|financeiro\/(?:contas-pagar|contas-receber)|servicos\/ordens)(?=\/|$)/

type ListFamily = { lists: readonly string[]; defaultList: string; recordPrefixes: readonly string[]; records?: readonly string[] }
const purchaseFamily: ListFamily = { lists: ["/compras/pedidos", "/compras/recebimentos"], defaultList: "/compras/pedidos", recordPrefixes: ["/compras/pedidos", "/compras/recebimentos"] }
const cashFamily: ListFamily = { lists: ["/vendas/pdv/historico"], defaultList: "/vendas/pdv/historico", recordPrefixes: [], records: ["/vendas/pdv/fechamento"] }

function isRecord(pathname: string, family: ListFamily) {
  return family.recordPrefixes.some(prefix => pathname.startsWith(prefix + "/")) || Boolean(family.records?.includes(pathname))
}

function listFamily(pathname: string): ListFamily | null {
  for (const family of [purchaseFamily, cashFamily]) if (family.lists.includes(pathname) || isRecord(pathname, family)) return family
  const list = pathname.match(listRoute)?.[0]
  return list ? { lists: [list], defaultList: list, recordPrefixes: [list] } : null
}

/** Carry a list's URL through its records without changing unrelated navigation. */
export function listNavigationHref(href: string, pathname: string, search: string) {
  const family = listFamily(pathname)
  if (!family || !href.startsWith("/") || href.startsWith("//")) return href
  try {
    const target = new URL(href, "https://erp.local")
    const params = new URLSearchParams(search)
    const previous = params.get("returnTo")
    const source = family.lists.includes(pathname) && search ? pathname + "?" + search : previous
    if (!source || !source.startsWith("/") || source.startsWith("//")) return href
    const origin = new URL(source, "https://erp.local")
    if (origin.origin !== "https://erp.local" || target.origin !== origin.origin || !family.lists.includes(origin.pathname) || !origin.search) return href
    const returnLink = target.pathname === origin.pathname || isRecord(pathname, family) && target.pathname === family.defaultList
    if (returnLink && !target.search) return origin.pathname + origin.search + target.hash
    if (isRecord(target.pathname, family) && !target.searchParams.has("returnTo")) {
      target.searchParams.set("returnTo", origin.pathname + origin.search)
      return target.pathname + target.search + target.hash
    }
  } catch { return href }
  return href
}
