"use client"

import { useEffect, useRef, useState } from "react"

export function useResource<T>(url: string) {
  const [state, setState] = useState<{ url: string; value: T | null; etag: string; error: string; pending: boolean }>({ url, value: null, etag: "", error: "", pending: true })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetch(url, { cache: "no-store", signal: controller.signal }).then(async response => {
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Consulta indisponível")
      if (!controller.signal.aborted) setState({ url, value, etag: response.headers.get("etag") || "", error: "", pending: false })
    }).catch(reason => {
      if (!controller.signal.aborted) setState({ url, value: null, etag: "", error: reason instanceof Error ? reason.message : "Consulta indisponível", pending: false })
    })
    return () => controller.abort()
  }, [url, revision])
  function reload() { setState(previous => ({ ...previous, pending: true })); setRevision(value => value + 1) }
  return { value: state.url === url ? state.value : null, etag: state.url === url ? state.etag : "", loading: state.url !== url || state.pending, error: state.url === url ? state.error : "", reload }
}

type Command = { url: string; tenant: string; body: string; etag: string; key: string; method: "POST" | "PUT" }

export function useCommand() {
  const current = useRef<Command | null>(null)
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [stale, setStale] = useState(false)
  const [error, setError] = useState("")

  async function send<T>(url: string, tenant: string, body: object, etag = "", method: "POST" | "PUT" = "POST"): Promise<T | null> {
    if (running.current || stale) return null
    running.current = true; setBusy(true); setError("")
    if (!uncertain) current.current = { url, tenant, body: JSON.stringify(body), etag, key: crypto.randomUUID(), method }
    const command = current.current!
    try {
      const response = await fetch(command.url, {
        method: command.method,
        headers: { "Content-Type": "application/json", "X-Tenant-Id": command.tenant, "Idempotency-Key": command.key, ...(command.etag ? { "If-Match": command.etag } : {}) },
        body: command.body,
      })
      const value = await response.json()
      if (!response.ok) {
        setUncertain(response.status >= 500); setStale(response.status === 412)
        setError(value.title || "Operação recusada")
        return null
      }
      if (!response.headers.get("etag")) throw new Error("Confirmação sem revisão")
      current.current = null; setUncertain(false)
      return value as T
    } catch {
      setUncertain(true); setError("Não foi possível confirmar o resultado. Repita a confirmação com o mesmo comando.")
      return null
    } finally { running.current = false; setBusy(false) }
  }
  function reset() { if (!uncertain && !running.current) { current.current = null; setStale(false); setError("") } }
  return { send, reset, busy, uncertain, stale, error }
}

export function quantity(raw: string) {
  if (!/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/.test(raw)) return null
  const [whole, fraction = ""] = raw.split(".")
  return `${whole}.${fraction.padEnd(6, "0")}`
}
