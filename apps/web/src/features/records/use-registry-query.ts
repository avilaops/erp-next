"use client"
import { useMemo } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { parseRegistryQuery, registryQueryString, registrySortFields, type RegistryListKind, type RegistryQuery } from "./registry-query"

export function useRegistryQuery(kind: RegistryListKind, allowedSort: readonly string[] = registrySortFields[kind]) {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const query = useMemo(() => parseRegistryQuery(params, kind, allowedSort), [params, kind, allowedSort])
  function navigate(value: RegistryQuery) {
    const latest = new URLSearchParams(window.location.search)
    const previous = latest.toString()
    for (const key of ["q", "status", "role", "offset", "sortBy", "sortOrder"]) latest.delete(key)
    new URLSearchParams(registryQueryString(value)).forEach((item, key) => latest.set(key, item))
    const next = latest.toString()
    if (next === previous) return false
    router.push(pathname + (next ? `?${next}` : "") + window.location.hash, { scroll: false })
    return true
  }
  return { query, navigate }
}
