"use client"

import { useCallback, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { nextTableSort, readTableSort, tableSortHref, tableSortQuery, type TableSortInitial } from "./table-sort-model"

export function useTableSort(allowed: readonly string[], initial: TableSortInitial, prefix = "") {
  const params = useSearchParams()
  const router = useRouter()
  const { by, order, explicit } = readTableSort(params, allowed, initial, prefix)
  const sort = useMemo(() => ({ by, order, explicit }), [by, order, explicit])
  const query = useMemo(() => tableSortQuery(sort), [sort])
  const allowedSignature = JSON.stringify(allowed)
  const initialBy = initial.by, initialOrder = initial.order
  const toggle = useCallback((field: string) => {
    const fields: string[] = JSON.parse(allowedSignature)
    if (!fields.includes(field)) return
    const latest = readTableSort(new URLSearchParams(window.location.search), fields, { by: initialBy, order: initialOrder }, prefix)
    const href = window.location.pathname + window.location.search + window.location.hash
    router.push(tableSortHref(href, nextTableSort(latest, field), prefix), { scroll: false })
  }, [allowedSignature, initialBy, initialOrder, prefix, router])
  return { sort, toggle, query }
}
