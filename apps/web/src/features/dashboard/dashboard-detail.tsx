"use client"

import Link from "next/link"
import { ArrowLeft, BarChart3, Download, Filter } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"

const dashboards = {
  geral: { title: "Dashboard geral", description: "Indicadores executivos da operação.", metrics: [["Receita", "R$ 184,6 mil"], ["Margem", "32,4%"], ["Pedidos", "120"], ["Clientes ativos", "84"]] },
  vendas: { title: "Dashboard de vendas", description: "Conversão, ticket e evolução comercial.", metrics: [["Vendas", "R$ 184,6 mil"], ["Ticket médio", "R$ 798,63"], ["Conversão", "31,8%"], ["Cancelados", "4"]] },
  "margem-pedidos": { title: "Margem por pedido", description: "Receita, custo e margem estimada por negociação.", metrics: [["Margem média", "32,4%"], ["Maior margem", "48,1%"], ["Em atenção", "7"], ["Pedidos", "120"]] },
  produtos: { title: "Dashboard de produtos", description: "Giro, estoque e desempenho do catálogo.", metrics: [["Produtos ativos", "3.257"], ["Sem saldo", "5"], ["Giro médio", "42 dias"], ["Margem", "34,8%"]] },
  clientes: { title: "Dashboard de clientes", description: "Aquisição, recorrência e valor por relacionamento.", metrics: [["Ativos", "84"], ["Novos", "12"], ["Recorrentes", "68%"], ["LTV médio", "R$ 14,2 mil"]] },
  "curva-abc": { title: "Curva ABC", description: "Participação dos produtos no faturamento.", metrics: [["Classe A", "72%"], ["Classe B", "19%"], ["Classe C", "9%"], ["SKUs analisados", "3.257"]] },
  metas: { title: "Metas", description: "Acompanhamento demonstrativo dos objetivos comerciais.", metrics: [["Meta mensal", "R$ 220 mil"], ["Realizado", "83,9%"], ["Restante", "R$ 35,4 mil"], ["Dias úteis", "5"]] },
} as const

export type DashboardKind = keyof typeof dashboards
export const dashboardKinds = Object.keys(dashboards).filter((kind) => kind !== "geral") as DashboardKind[]

export function DashboardDetail({ kind }: { kind: DashboardKind }) {
  const config = dashboards[kind]
  const [period, setPeriod] = useState("6M")
  const [notice, setNotice] = useState("")
  return (
    <div className="mx-auto max-w-[1450px] px-4 pb-24 pt-8 lg:px-6">
      <Link className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" href="/"><ArrowLeft className="size-4" />Visão geral</Link>
      <header className="mt-6 flex flex-col gap-5 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="text-sm font-medium text-primary">Meu Negócio</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{config.title}</h1><p className="mt-3 text-muted-foreground">{config.description} Dados locais demonstrativos.</p></div>
        <div className="flex flex-wrap gap-2"><select aria-label="Período do dashboard" className="h-9 rounded-lg border border-input bg-background px-3 text-sm" value={period} onChange={(event) => setPeriod(event.target.value)}><option>30D</option><option>3M</option><option>6M</option><option>12M</option></select><Button variant="outline" onClick={() => setNotice("Exportação preparada somente como demonstração; nenhum arquivo foi criado.")}><Download />Exportar visão</Button></div>
      </header>
      {notice && <p className="mt-5 rounded-xl border border-primary/20 bg-primary/10 p-3 text-sm" role="status">{notice}</p>}
      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{config.metrics.map(([label, value]) => <div className="rounded-2xl border border-border bg-card p-5" key={label}><span className="text-sm text-muted-foreground">{label}</span><strong className="mt-2 block text-2xl">{value}</strong></div>)}</section>
      <section className="mt-6 rounded-2xl border border-border bg-card p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Evolução · {period}</h2><p className="mt-1 text-sm text-muted-foreground">Comparação visual sem consulta ao backend.</p></div><Filter className="size-5 text-muted-foreground" /></div><div className="mt-7 grid h-64 grid-cols-8 items-end gap-3" aria-label={`Evolução do dashboard no período ${period}`}>{[38, 48, 42, 61, 57, 72, 69, 86].map((value, index) => <div className="group flex h-full items-end" key={index}><div className="w-full rounded-t bg-primary/75 transition group-hover:bg-primary" style={{ height: `${value}%` }} title={`${value}%`} /></div>)}</div></section>
      <section className="mt-6 grid gap-3 md:grid-cols-3">{["Principal indicador", "Comparação anterior", "Projeção"].map((title, index) => <article className="rounded-2xl border border-border bg-card p-5" key={title}><BarChart3 className="size-5 text-primary" /><h2 className="mt-4 font-semibold">{title}</h2><p className="mt-2 text-sm text-muted-foreground">{index === 0 ? "Desempenho dentro da faixa esperada." : index === 1 ? "+8,4% sobre o período anterior." : "Tendência positiva na demonstração."}</p></article>)}</section>
    </div>
  )
}
