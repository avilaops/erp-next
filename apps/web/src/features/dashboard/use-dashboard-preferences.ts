"use client"

import { useRef, useState } from "react"
import { erpFetch } from "@/lib/api/client"
import type { Schema } from "@/lib/api/types"
import { useResource } from "@/features/operations/use-operation"
import { useNavigationGuard } from "@/components/navigation-guard"

type Layout = Schema<"DashboardLayout">
type Preferences = Schema<"PreferencesSnapshot">

const defaultLayout: Layout = {
  favoritePaths: ["/vendas/pedidos", "/compras/pedidos", "/cadastros/clientes-fornecedores", "/cadastros/produtos", "/financeiro/contas-receber"],
  charts: ["Ticket médio", "Valor faturado"],
  period: "6M",
}

export function useDashboardPreferences() {
  const resource = useResource<Preferences>("/api/erp/preferences")
  const [draft, setDraft] = useState<Layout | null>(null)
  const [saved, setSaved] = useState<{ value: Preferences; etag: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const pending = useRef(false)
  const current = saved?.value || resource.value
  const etag = saved?.etag || resource.etag
  const layout = draft || current?.data.dashboardLayout || defaultLayout
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(current?.data.dashboardLayout || defaultLayout)
  useNavigationGuard(dirty ? "Sair e descartar as alterações da página inicial?" : null)

  function update(change: (value: Layout) => Layout) {
    if (busy || blocked || resource.loading || !current) return
    setDraft(value => change(value || current?.data.dashboardLayout || defaultLayout))
    setMessage("")
  }

  async function save() {
    if (!current || !etag || !dirty || blocked || pending.current) return
    pending.current = true; setBusy(true); setError(""); setMessage("")
    try {
      const response = await erpFetch("/api/erp/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Tenant-Id": current.tenantId, "If-Match": etag },
        body: JSON.stringify({ productPageSize: current.data.productPageSize, ownerKey: current.ownerKey, dashboardLayout: layout } satisfies Schema<"Preferences">),
      })
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Não foi possível salvar a página inicial")
      const nextEtag = response.headers.get("etag")
      if (!nextEtag || value.tenantId !== current.tenantId || value.ownerKey !== current.ownerKey || JSON.stringify(value.data?.dashboardLayout) !== JSON.stringify(layout)) {
        throw new Error("Confirmação incompleta. Recarregue para conferir a gravação.")
      }
      setSaved({ value, etag: nextEtag }); setDraft(null)
      setMessage("Página inicial salva para sua conta nesta empresa.")
    } catch (reason) {
      setBlocked(true)
      setError(reason instanceof Error ? reason.message : "Não foi possível confirmar a gravação")
    } finally { pending.current = false; setBusy(false) }
  }

  function reload() {
    if (busy || (dirty && !window.confirm("Recarregar e descartar as alterações da página inicial?"))) return
    setDraft(null); setSaved(null); setBlocked(false); setMessage(""); setError("")
    resource.reload()
  }

  return { layout, update, save, reload, dirty, busy, blocked,
    editable: !!current && !resource.loading && !busy && !blocked,
    canSave: !!current && !!etag && dirty && !busy && !blocked && !resource.loading,
    loading: resource.loading, error: error || resource.error, message }
}
