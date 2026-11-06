"use client"

import { useState } from "react"
import { useResource } from "@/hooks/use-operation"
import { Input } from "@/components/ui/input"
import { money, percent } from "./negotiation-types"

type Metrics = { tenantId: string; data: Record<string, number | string | null> }
export function CommercialMetrics({ kind }: { kind: "orders" | "commissions" }) {
  const [month, setMonth] = useState("")
  const metrics = useResource<Metrics>(`/api/erp/commercial/metrics/${kind}${month ? `?month=${month}` : ""}`)
  const value = metrics.value?.data
  const numeric = (key: string) => typeof value?.[key] === "number" ? value[key] as number : 0
  const rows = kind === "orders" ? [["Em aberto", money(numeric("openCents"))], ["Pedidos em aberto", String(numeric("openCount"))], ["Concluídos na competência", money(numeric("completedCents"))], ["Pedidos concluídos", String(numeric("completedCount"))], ["Aguardando aprovação", String(numeric("pendingApprovalCount"))], ["Desconto médio das negociações concluídas", value?.averageDiscountBps == null ? "Sem negociações concluídas" : percent(numeric("averageDiscountBps"))]] : [["Base líquida dos recebimentos com comissão", money(numeric("receivedBaseCents"))], ["Comissão da competência", money(numeric("commissionCents"))], ["Vendedores na competência", String(numeric("sellerCount"))], ["Falta pagar, incluindo competências anteriores", money(numeric("outstandingCents"))], ["Comissão futura estimada", money(numeric("futureCents"))]]
  return <details className="form-section min-w-0 space-y-4"><summary className="cursor-pointer font-medium">Ver indicadores {value?.month ? `· ${value.month}` : ""}</summary><div className="space-y-4 pt-3"><label className="grid max-w-xs gap-2">Competência<Input type="month" value={month || String(value?.month || "")} onChange={e => setMonth(e.target.value)} /></label>{metrics.loading ? <p role="status">Carregando indicadores…</p> : metrics.error ? <p role="alert">{metrics.error}</p> : value && <dl className="grid min-w-0 gap-4 sm:grid-cols-2">{rows.map(([label, amount]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold">{amount}</dd></div>)}</dl>}<p className="text-xs text-muted-foreground">{kind === "commissions" ? "A base líquida considera o livro de comissões, sem IPI e com estornos. A estimativa futura usa o saldo dos pedidos com comissão configurada e não constitui comissão apurada." : "Conclusões usam a data do evento de conclusão. Desconto médio considera somente pedidos com negociação preservada."}</p></div></details>
}
