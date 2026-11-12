"use client"
import { useEffect, useState } from "react"
import { erpFetch } from "@/lib/api/client"
import { loadReferenceHierarchy, type HierarchyEndpoint, type ReferenceOption } from "./reference-hierarchy"

export function useReferenceHierarchy(endpoint: HierarchyEndpoint, tenant?: string) {
  const key = `${endpoint}:${tenant || ""}`
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<{ key: string; options: ReferenceOption[]; error: string; pending: boolean }>({ key: "", options: [], error: "", pending: false })
  useEffect(() => {
    if (!tenant) return
    const controller = new AbortController()
    loadReferenceHierarchy(endpoint, tenant, controller.signal, erpFetch).then(options => {
      if (!controller.signal.aborted) setState({ key, options, error: "", pending: false })
    }).catch(reason => {
      if (!controller.signal.aborted) setState({ key, options: [], error: reason instanceof Error ? reason.message : "Categorias indisponíveis", pending: false })
    })
    return () => controller.abort()
  }, [endpoint, tenant, key, retry])
  return {
    options: state.key === key ? state.options : [],
    error: state.key === key ? state.error : "",
    loading: !tenant || state.key !== key || state.pending,
    reload: () => { setState(previous => ({ ...previous, pending: true })); setRetry(value => value + 1) },
  }
}
