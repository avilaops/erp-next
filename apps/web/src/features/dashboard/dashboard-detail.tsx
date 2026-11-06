"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { RequestError } from "@/components/feedback/session-recovery"
import { money, SalesSeries, useDashboardData } from "./dashboard-data"

const dashboards = {
  geral: { title: "Dashboard geral", description: "Indicadores da empresa ativa." },
  vendas: { title: "Dashboard de vendas", description: "Pedidos não cancelados por data de criação. Valores de pedidos não representam faturamento ou recebimento." },
  "margem-pedidos": { title: "Margem por pedido", description: "A análise requer custos e condições comerciais preservados por pedido." },
  produtos: { title: "Dashboard de produtos", description: "Produtos ativos no cadastro atual da empresa." },
  clientes: { title: "Dashboard de clientes", description: "Clientes ativos no cadastro atual da empresa." },
  "curva-abc": { title: "Curva ABC", description: "A classificação requer uma base de faturamento por produto." },
  metas: { title: "Metas", description: "Objetivos comerciais da empresa ativa." },
} as const
export type DashboardKind = keyof typeof dashboards
export const dashboardKinds = Object.keys(dashboards).filter(kind => kind !== "geral") as DashboardKind[]

export function DashboardDetail({ kind }: { kind: DashboardKind }) {
  const config = dashboards[kind]
  const [period, setPeriod] = useState("6M")
  const result = useDashboardData(period)
  const available = ["geral", "vendas", "produtos", "clientes"].includes(kind)
  const data = result.value
  const metrics = !data ? [] : kind === "produtos" ? [["Produtos ativos", data.products?.toLocaleString("pt-BR") ?? "Sem permissão"]] : kind === "clientes" ? [["Clientes ativos", data.customers?.toLocaleString("pt-BR") ?? "Sem permissão"]] : kind === "vendas" ? [["Pedidos", data.sales?.orders.toLocaleString("pt-BR") ?? "Sem permissão"], ["Valor em pedidos", money(data.sales?.amount)], ["Ticket médio", money(data.sales?.average)], ["Cancelados", data.sales?.cancelled.toLocaleString("pt-BR") ?? "Sem permissão"]] : [["Pedidos no período", data.sales?.orders.toLocaleString("pt-BR") ?? "Sem permissão"], ["Saldo a receber", money(data.receivables)], ["Saldo a pagar de compras", money(data.purchasePayables)], ["Produtos ativos", data.products?.toLocaleString("pt-BR") ?? "Sem permissão"]]
  return <div className="mx-auto w-full min-w-0 max-w-[1450px] px-4 pb-24 pt-8 lg:px-6">
    <Link className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" href="/"><ArrowLeft className="size-4" />Visão geral</Link>
    <header className="mt-6 flex flex-col gap-5 border-b pb-7 lg:flex-row lg:items-end lg:justify-between"><div className="min-w-0"><p className="text-sm font-medium text-primary">Meu Negócio</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{config.title}</h1><p className="mt-3 text-muted-foreground">{config.description}</p></div>{available && <div className="flex shrink-0 flex-wrap gap-2"><select aria-label="Período do dashboard" className="h-10 rounded-lg border bg-background px-3 text-sm" value={period} onChange={event => setPeriod(event.target.value)}>{["7D", "30D", "3M", "6M", "12M"].map(value => <option key={value}>{value}</option>)}</select><Button variant="outline" onClick={result.reload}>Atualizar</Button></div>}</header>
    {!available ? <section className="form-section mt-6 space-y-4"><h2 className="font-semibold">{kind === "metas" ? "Metas ainda não cadastradas" : "Análise ainda indisponível"}</h2><p>{kind === "metas" ? "O ERP ainda não possui cadastro de metas comerciais. Nenhuma meta, projeção ou percentual de realização foi calculado." : "Os dados necessários para esta análise ainda não estão disponíveis neste painel."}</p><Link className="inline-block text-primary underline" href="/vendas/pedidos">Consultar pedidos reais</Link></section> : result.loading ? <p className="mt-6" role="status">Consultando dados da empresa…</p> : result.error ? <p className="mt-6" role="alert"><RequestError message={result.error} status={result.status} /></p> : data && <>
      <p className="mt-5 text-sm text-muted-foreground">Pedidos: {data.startDate} a {data.endDate}. Saldos e cadastros refletem a posição atual.</p>
      <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(([label, value]) => <div key={label} className="min-w-0 rounded-2xl border bg-card p-5"><span className="text-sm text-muted-foreground">{label}</span><strong className="mt-2 block break-words text-2xl">{value}</strong></div>)}</section>
      {["geral", "vendas"].includes(kind) && <section className="mt-6 rounded-2xl border bg-card p-5"><h2 className="font-semibold">Pedidos por mês</h2><SalesSeries data={data} /></section>}
      <p className="mt-6"><Link className="text-primary underline" href={kind === "produtos" ? "/cadastros/produtos" : kind === "clientes" ? "/cadastros/clientes-fornecedores" : "/vendas/pedidos"}>Abrir registros de origem</Link></p>
    </>}
  </div>
}
