export type TableSort = { by: string; order: "asc" | "desc"; explicit: boolean }
export type TableSortInitial = Pick<TableSort, "by" | "order">
export type TableSortValue = string | number | bigint | Date | null | undefined

function sortKeys(prefix: string) {
  return prefix ? [`${prefix}SortBy`, `${prefix}SortOrder`] as const : ["sortBy", "sortOrder"] as const
}

/** Invalid browser state falls back to the screen's original ordering. */
export function readTableSort(params: Pick<URLSearchParams, "get">, allowed: readonly string[], initial: TableSortInitial, prefix = ""): TableSort {
  const [byKey, orderKey] = sortKeys(prefix)
  const by = params.get(byKey)
  const order = params.get(orderKey)
  if (!by || !allowed.includes(by) || (order !== null && order !== "asc" && order !== "desc")) return { ...initial, explicit: false }
  return { by, order: order ?? "asc", explicit: true }
}

export function nextTableSort(state: TableSort, field: string): TableSort {
  return { by: field, order: state.explicit && state.by === field && state.order === "asc" ? "desc" : "asc", explicit: true }
}

/** API requests always use canonical keys even when a dashboard scopes its URL keys. */
export function tableSortQuery(sort: TableSort): URLSearchParams {
  return new URLSearchParams(sort.explicit ? { sortBy: sort.by, sortOrder: sort.order } : {})
}

/** Change only sorting, keeping filters, offsets, duplicate parameters and fragments. */
export function tableSortHref(href: string, sort: TableSort, prefix = ""): string {
  const fragmentIndex = href.indexOf("#")
  const fragment = fragmentIndex < 0 ? "" : href.slice(fragmentIndex)
  const address = fragmentIndex < 0 ? href : href.slice(0, fragmentIndex)
  const queryIndex = address.indexOf("?")
  const path = queryIndex < 0 ? address : address.slice(0, queryIndex)
  const params = new URLSearchParams(queryIndex < 0 ? "" : address.slice(queryIndex + 1))
  const [byKey, orderKey] = sortKeys(prefix)
  if (sort.explicit) {
    params.set(byKey, sort.by)
    params.set(orderKey, sort.order)
  } else {
    params.delete(byKey)
    params.delete(orderKey)
  }
  const query = params.toString()
  return path + (query ? `?${query}` : "") + fragment
}

const textOrder = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true })

function normalized(value: TableSortValue): string | number | bigint | null {
  if (value == null) return null
  const result = value instanceof Date ? value.getTime() : value
  return typeof result === "number" && !Number.isFinite(result) ? null : result
}

function compare(left: string | number | bigint, right: string | number | bigint): number {
  if (typeof left === "string" && typeof right === "string") return textOrder.compare(left, right)
  return left < right ? -1 : left > right ? 1 : 0
}

/** Only use for complete collections; paginated server results must sort upstream. */
export function sortTableRows<T>(rows: readonly T[], sort: TableSort, accessors: Readonly<Record<string, (row: T) => TableSortValue>>, getKey: (row: T) => string | number | bigint): T[] {
  const accessor = accessors[sort.by]
  if (!accessor) return [...rows]
  return [...rows].sort((left, right) => {
    const a = normalized(accessor(left))
    const b = normalized(accessor(right))
    if (a === null && b !== null) return 1
    if (a !== null && b === null) return -1
    const result = a === null || b === null ? 0 : compare(a, b)
    if (result) return sort.order === "desc" ? -result : result
    // Keep tie-breaking deterministic in both directions, including collator-equivalent IDs.
    const keyA = getKey(left)
    const keyB = getKey(right)
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0
  })
}
