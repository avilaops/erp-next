"use client"

import { useEffect, useRef, useState } from "react"
import { erpFetch } from "@/lib/api/client"
import type { Schema } from "@/lib/api/types"
import { useNavigationGuard } from "@/components/navigation-guard"

type Layout = Schema<"DashboardLayout">
type Preferences = Schema<"PreferencesSnapshot">
type Snapshot = { value: Preferences; etag: string }

const defaultLayout: Layout = {
  favoritePaths: ["/vendas/pedidos", "/compras/pedidos", "/cadastros/clientes-fornecedores", "/cadastros/produtos", "/financeiro/contas-receber"],
  charts: ["Ticket médio", "Valor faturado"],
  period: "6M",
}

export function useDashboardPreferences() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const current = useRef<Snapshot | null>(null)
  const [draft, setDraft] = useState<Layout | null>(null)
  const editing = useRef<Layout | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  const generation = useRef(0)
  const pending = useRef(false)
  const command = useRef<AbortController | null>(null)
  const layout = loading || !snapshot ? defaultLayout : draft || snapshot?.value.data.dashboardLayout || defaultLayout
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(snapshot?.value.data.dashboardLayout || defaultLayout)
  useNavigationGuard(dirty ? "Sair e descartar as alterações da página inicial?" : null)

  useEffect(() => {
    let active = true
    let request: AbortController | null = null
    async function load() {
      request?.abort()
      const controller = new AbortController()
      request = controller
      const version = ++generation.current
      try {
        const response = await erpFetch("/api/erp/preferences", {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        })
        const value = await response.json()
        if (!active || controller.signal.aborted || version !== generation.current) return
        if (!response.ok) throw new Error(value.title || "Não foi possível carregar sua página inicial")
        const etag = response.headers.get("etag")
        if (!etag || typeof value.ownerKey !== "string" || !value.data?.dashboardLayout) throw new Error("Preferências sem confirmação de conta e revisão")
        const previous = current.current
        const changedOwner = previous && previous.value.ownerKey !== value.ownerKey
        if (changedOwner) {
          editing.current = null; setDraft(null); setBlocked(false)
          setMessage("A conta ou empresa mudou. Foram carregadas as preferências da sessão atual.")
        } else if (editing.current && previous && previous.etag !== etag) {
          setBlocked(true)
          setError("As preferências mudaram em outra tela. Sua edição foi preservada; recarregue para conferir.")
          return
        }
        const next = { value: value as Preferences, etag }
        current.current = next; setSnapshot(next); setError("")
      } catch (reason) {
        if (active && !controller.signal.aborted && version === generation.current) {
          current.current = null; setSnapshot(null)
          setError(reason instanceof Error ? reason.message : "Consulta indisponível")
        }
      } finally {
        if (active && version === generation.current) setLoading(false)
      }
    }
    function invalidate() {
      generation.current++; request?.abort(); command.current?.abort()
      setLoading(true); setMessage("")
    }
    function visibility() {
      if (document.visibilityState === "hidden") invalidate()
      else { setLoading(true); void load() }
    }
    void load()
    const focus = () => { setLoading(true); void load() }
    window.addEventListener("blur", invalidate)
    window.addEventListener("focus", focus)
    window.addEventListener("pageshow", focus)
    document.addEventListener("visibilitychange", visibility)
    return () => {
      active = false; generation.current++; request?.abort(); command.current?.abort()
      window.removeEventListener("blur", invalidate)
      window.removeEventListener("focus", focus)
      window.removeEventListener("pageshow", focus)
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [revision])

  function update(change: (value: Layout) => Layout) {
    if (busy || blocked || loading || !snapshot) return
    const next = change(editing.current || snapshot.value.data.dashboardLayout)
    editing.current = next; setDraft(next); setMessage("")
  }

  async function save() {
    if (!snapshot || !dirty || blocked || loading || pending.current) return
    pending.current = true; setBusy(true); setError(""); setMessage("")
    const version = generation.current
    const controller = new AbortController()
    command.current = controller
    try {
      const response = await erpFetch("/api/erp/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Tenant-Id": snapshot.value.tenantId, "If-Match": snapshot.etag },
        body: JSON.stringify({
          productPageSize: snapshot.value.data.productPageSize,
          ownerKey: snapshot.value.ownerKey, dashboardLayout: layout,
        } satisfies Schema<"Preferences">),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      })
      const value = await response.json()
      if (controller.signal.aborted || version !== generation.current) return
      if (!response.ok) throw new Error(value.title || "Não foi possível salvar a página inicial")
      const etag = response.headers.get("etag")
      if (!etag || value.tenantId !== snapshot.value.tenantId || value.ownerKey !== snapshot.value.ownerKey
        || JSON.stringify(value.data?.dashboardLayout) !== JSON.stringify(layout)) {
        throw new Error("Confirmação incompleta. Recarregue para conferir a gravação.")
      }
      const next = { value, etag }
      current.current = next; setSnapshot(next); editing.current = null; setDraft(null)
      setMessage("Página inicial salva para sua conta nesta empresa.")
    } catch (reason) {
      if (!controller.signal.aborted && version === generation.current) {
        setBlocked(true)
        setError(reason instanceof Error ? reason.message : "Não foi possível confirmar a gravação")
      }
    } finally { pending.current = false; setBusy(false) }
  }

  function reload() {
    if (busy || (dirty && !window.confirm("Recarregar e descartar as alterações da página inicial?"))) return
    editing.current = null; setDraft(null); setBlocked(false); setMessage(""); setError("")
    setLoading(true); setRevision(value => value + 1)
  }

  return { layout, update, save, reload, dirty, busy, blocked,
    editable: !!snapshot && !loading && !busy && !blocked,
    canSave: !!snapshot && dirty && !loading && !busy && !blocked,
    loading, error, message }
}
