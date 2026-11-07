"use client"

import Link from "next/link"
import { BarChart3, Boxes, CircleDollarSign, ShieldCheck, ShoppingCart, Wrench } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { useDashboardData, money } from "@/features/dashboard/dashboard-data"
import { DashboardDetail } from "@/features/dashboard/dashboard-detail"
import { FinanceReportLive } from "./finance-report-live"
import { StockReportLive } from "./stock-report-live"
import { ServiceReportsLive } from "@/features/services/service-reports-live"

type ReportCard = {
  slug: string
  title: string
  description: string
  icon: LucideIcon
}

const reports: ReportCard[] = [
  { slug: "vendas", title: "Vendas", description: "Receita, pedidos, ticket médio e conversão.", icon: ShoppingCart },
  { slug: "estoque", title: "Estoque", description: "Posição, saldos e movimentações autorizadas.", icon: Boxes },
  { slug: "financeiro", title: "Financeiro", description: "Recebíveis, contas a pagar e saldos operacionais.", icon: CircleDollarSign },
  { slug: "servicos", title: "Serviços", description: "Ordens, produtividade e custos calculados a partir da operação.", icon: Wrench },
  { slug: "auditoria", title: "Auditoria", description: "Alterações, acessos e operações sensíveis.", icon: ShieldCheck },
]

const executiveReport: ReportCard = {
  slug: "executivo",
  title: "Visão executiva",
  description: "Resumo operacional da empresa ativa, com vendas, recebíveis, contas a pagar e cadastros.",
  icon: BarChart3,
}

export function ReportsHub() {
  const dashboard = useDashboardData("30D")
  const valueFor = (slug: string) => {
    const data = dashboard.value
    if (!data) return dashboard.loading ? "Carregando…" : "Indisponível"
    if (slug === "vendas") return data.sales ? `${data.sales.orders.toLocaleString("pt-BR")} pedidos` : "Sem permissão"
    if (slug === "financeiro") return data.receivables == null ? "Sem permissão" : money(data.receivables)
    if (slug === "estoque") return data.products == null ? "Sem permissão" : `${data.products.toLocaleString("pt-BR")} produtos`
    return "Consultar fonte"
  }
  return (
    <div className="mx-auto max-w-[1500px] px-4 pb-24 pt-8 lg:px-6">
      <PageHeader eyebrow="Relatórios" title="Todos os relatórios" description="Indicadores disponíveis para a empresa ativa. Cada cartão usa uma fonte operacional autorizada." />
      <section className="mt-7 rounded-2xl border border-primary/20 bg-primary/5 p-5">
        <Link className="flex items-start gap-4" href="/relatorios/executivo">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"><BarChart3 className="size-5" /></span>
          <span><strong className="block text-lg">{executiveReport.title}</strong><span className="mt-1 block text-sm text-muted-foreground">{executiveReport.description}</span><span className="mt-3 inline-block text-sm font-medium text-primary">Abrir visão executiva →</span></span>
        </Link>
      </section>
      <h2 className="mt-8 text-xl font-semibold">Relatórios por área</h2>
      <section className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {reports.map(({ icon: Icon, ...report }) => (
          <Link className="rounded-2xl border border-border bg-card p-5 transition hover:-translate-y-0.5 hover:border-primary/40" href={`/relatorios/${report.slug}`} key={report.slug}>
            <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" /></span>
            <h2 className="mt-5 text-lg font-semibold">{report.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{report.description}</p>
            <div className="mt-5 flex items-end justify-between gap-3">
              <strong className="text-xl">{valueFor(report.slug)}</strong>
              <span className="text-xs text-muted-foreground">
                {report.slug === "vendas" && dashboard.value?.sales ? money(dashboard.value.sales.amount) : report.slug === "financeiro" && dashboard.value?.purchasePayables != null ? `A pagar ${money(dashboard.value.purchasePayables)}` : "Fonte específica"}
              </span>
            </div>
          </Link>
        ))}
      </section>
    </div>
  )
}

export function ReportDetail({ kind }: { kind: string }) {
  if (kind === "executivo") return <DashboardDetail kind="geral" />
  if (kind === "vendas") return <DashboardDetail kind="vendas" />
  if (kind === "financeiro") return <FinanceReportLive />
  if (kind === "estoque") return <StockReportLive />
  if (kind === "servicos") return <ServiceReportsLive />
  return <ReportCapabilityUnavailable kind={kind} />
}

function ReportCapabilityUnavailable({ kind }: { kind: string }) {
  return (
    <div className="mx-auto max-w-4xl px-4 pb-24 pt-8 lg:px-6">
      <PageHeader eyebrow="Relatórios" title={`Relatório de ${kind}`} description="A fonte operacional deste relatório ainda não está habilitada." />
      <section className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6">
        <h2 className="text-lg font-semibold">Relatório indisponível</h2>
        <p className="mt-2 text-sm text-muted-foreground">Nenhum indicador, registro ou exportação demonstrativa será exibido.</p>
        <Link className="mt-5 inline-flex min-h-11 items-center font-medium text-primary underline" href="/relatorios">Voltar para Relatórios</Link>
      </section>
    </div>
  )
}
