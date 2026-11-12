const listRoute = /^\/(?:cadastros\/[^/]+|vendas\/(?:pedidos|propostas|funil)|compras\/pedidos|financeiro\/(?:contas-pagar|contas-receber)|servicos\/ordens)(?=\/|$)/

/** Carry a list's URL through its records without changing unrelated navigation. */
export function listNavigationHref(href: string, pathname: string, search: string) {
  const list = pathname.match(listRoute)?.[0]
  if (!list || !href.startsWith("/") || href.startsWith("//")) return href
  try {
    const target = new URL(href, "https://erp.local")
    const params = new URLSearchParams(search)
    const previous = params.get("returnTo")
    const source = pathname === list && search ? list + "?" + search : previous
    if (!source || !source.startsWith(list + "?")) return href
    const origin = new URL(source, "https://erp.local")
    if (origin.origin !== target.origin || origin.pathname !== list) return href
    if (target.pathname === list && !target.search) return list + origin.search + target.hash
    if (target.pathname.startsWith(list + "/") && !target.searchParams.has("returnTo")) {
      target.searchParams.set("returnTo", list + origin.search)
      return target.pathname + target.search + target.hash
    }
  } catch { return href }
  return href
}
