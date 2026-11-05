"use client"

import Link from "next/link"
import type { Schema } from "@/lib/api/types"
import { useResource } from "@/hooks/use-operation"
import { RequestError } from "@/components/feedback/session-recovery"
import { useEffect, useState } from "react"

function useDashboardResource<T>(url: string) {
  const resource = useResource<T>(url)
  const [hidden, setHidden] = useState(false)
  const reload = resource.reload
  useEffect(() => {
    const invalidate = () => setHidden(true)
    const refresh = () => { setHidden(false); reload() }
    const visibility = () => document.visibilityState === "hidden" ? invalidate() : refresh()
    window.addEventListener("blur", invalidate)
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", visibility)
    return () => { window.removeEventListener("blur", invalidate); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", visibility) }
  }, [reload])
  return { ...resource, loading: resource.loading || hidden, value: resource.loading || hidden ? null : resource.value }
}

export type DashboardData = Schema<"DashboardSnapshot">
export function useDashboardData(period: string) {
  return useDashboardResource<DashboardData>(`/api/erp/dashboard?period=${encodeURIComponent(period)}`)
}

export function money(value: string | null | undefined) {
  if (value == null) return "Sem permissão"
  const [integer, fraction = ""] = value.split(".")
  return `R$ ${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction.padEnd(2, "0")}`
}

export function SalesSeries({ data, average = false }: { data: DashboardData; average?: boolean }) {
  if (!data.salesSeries) return <p className="mt-4 text-sm">Seu acesso não permite consultar pedidos.</p>
  if (!data.salesSeries.length) return <p className="mt-4 text-sm">Nenhum pedido neste período.</p>
  return <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Pedidos não cancelados, agrupados por mês de criação</caption><thead><tr className="border-b"><th className="p-2">Mês</th><th className="p-2">Pedidos</th><th className="p-2">{average ? "Ticket médio" : "Valor em pedidos"}</th></tr></thead><tbody>{data.salesSeries.map(row => <tr key={row.month} className="border-b"><td className="whitespace-nowrap p-2">{row.month.split("-").reverse().join("/")}</td><td className="p-2">{row.orders}</td><td className="whitespace-nowrap p-2">{money(average ? row.average : row.amount)}</td></tr>)}</tbody></table></div>
}

export function RecentActivity() {
  const result = useDashboardResource<Schema<"AuditResponse">>("/api/erp/audit")
  return <aside className="min-w-0 self-start rounded-2xl border border-border bg-card" aria-label="Atividade recente"><div className="border-b border-border p-5"><h2 className="font-semibold">Atividade recente</h2></div><div className="space-y-3 p-5 text-sm">{result.loading ? <p role="status">Consultando atividades…</p> : result.error ? <p role="status"><RequestError message={result.status === 403 ? "Seu acesso não permite consultar a auditoria." : result.error} status={result.status} /></p> : result.value?.data.length ? <ul className="space-y-4">{result.value.data.slice(0, 5).map(event => <li key={event.id} className="break-words"><strong className="block">{event.action}</strong><span className="block text-muted-foreground">{event.actor || "Autor não informado"} · {event.entityType}</span><time className="text-xs text-muted-foreground" dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString("pt-BR")}</time></li>)}</ul> : <p>Nenhuma atividade registrada.</p>}<Link className="inline-block text-primary underline" href="/preferencias/seguranca">Consultar auditoria</Link></div></aside>
}
