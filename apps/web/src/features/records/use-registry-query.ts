"use client"
import { useMemo } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { parseRegistryQuery, registryQueryString, type RegistryListKind, type RegistryQuery } from "./registry-query"

export function useRegistryQuery(kind: RegistryListKind) {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const query = useMemo(() => parseRegistryQuery(params, kind), [params, kind])
  function navigate(value: RegistryQuery) {
    const next = registryQueryString(value)
    if (next === params.toString()) return false
    router.push(pathname + (next ? `?${next}` : ""), { scroll: false })
    return true
  }
  return { query, navigate }
}
