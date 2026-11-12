"use client"

import { erpFetch } from "@/lib/api/client"

import { normalizeDecimal } from "@/lib/decimal-input"

import { useEffect, useRef, useState } from "react"

type ApiProblem = { title?: unknown }

async function readJson(response: Response): Promise<unknown> {
  const body = await response.text()
  if (!body.trim()) throw new Error("O ERP retornou uma resposta vazia. Atualize o serviço e tente novamente.")
  try { return JSON.parse(body) } catch { throw new Error("O ERP retornou uma resposta inválida. Tente novamente.") }
}

function message(value: unknown, fallback: string) {
  return typeof (value as ApiProblem | null)?.title === "string" ? (value as ApiProblem).title as string : fallback
}

export function useResource<T>(url: string) {
  const [state, setState] = useState<{ url: string; value: T | null; etag: string; error: string; pending: boolean; status: number }>({ url, value: null, etag: "", error: "", pending: true, status: 0 })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let status = 0
    erpFetch(url, { cache: "no-store", signal: controller.signal }).then(async response => {
      status = response.status
      const value = await readJson(response)
      if (!response.ok) throw new Error(message(value, "Consulta indisponível"))
      if (!controller.signal.aborted) setState({ url, value: value as T, etag: response.headers.get("etag") || "", error: "", pending: false, status })
    }).catch(reason => {
      if (!controller.signal.aborted) setState({ url, value: null, etag: "", error: reason instanceof Error ? reason.message : "Consulta indisponível", pending: false, status })
    })
    return () => controller.abort()
  }, [url, revision])
  function reload() { setState(previous => ({ ...previous, pending: true })); setRevision(value => value + 1) }
  return { value: state.url === url ? state.value : null, etag: state.url === url ? state.etag : "", loading: state.url !== url || state.pending, error: state.url === url ? state.error : "", status: state.url === url ? state.status : 0, reload }
}

type Command = { url: string; tenant: string; body: string; etag: string; key: string; method: "POST" | "PUT" }

export function useCommand() {
  const current = useRef<Command | null>(null)
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [stale, setStale] = useState(false)
  const [error, setError] = useState("")
  const [status, setStatus] = useState(0)

  async function send<T>(url: string, tenant: string, body: object, etag = "", method: "POST" | "PUT" = "POST", confirm?: (reply: T) => boolean): Promise<T | null> {
    if (running.current || stale) return null
    running.current = true; setBusy(true); setError(""); setStatus(0)
    if (!uncertain) current.current = { url, tenant, body: JSON.stringify(body), etag, key: crypto.randomUUID(), method }
    const command = current.current!
    const wasUncertain = uncertain
    try {
      const response = await erpFetch(command.url, {
        method: command.method,
        headers: { "Content-Type": "application/json", "X-Tenant-Id": command.tenant, "Idempotency-Key": command.key, ...(command.etag ? { "If-Match": command.etag } : {}) },
        body: command.body,
      })
      setStatus(response.status)
      const value = await readJson(response)
      if (!response.ok) {
        setUncertain(wasUncertain || response.status >= 500); setStale(!wasUncertain && response.status === 412)
        setError(message(value, "Operação recusada"))
        return null
      }
      if (!response.headers.get("etag")) throw new Error("Confirmação sem revisão")
      if (confirm && !confirm(value as T)) throw new Error("Confirmação incompleta ou de outra empresa")
      current.current = null; setUncertain(false)
      return value as T
    } catch {
      setUncertain(true); setError("Não foi possível confirmar o resultado. Repita a confirmação com o mesmo comando.")
      return null
    } finally { running.current = false; setBusy(false) }
  }
  function reset() { if (!uncertain && !running.current) { current.current = null; setStale(false); setError("") } }
  return { send, reset, busy, uncertain, stale, error, status }
}

export function quantity(raw: string) {
  return normalizeDecimal(raw, 6)
}
