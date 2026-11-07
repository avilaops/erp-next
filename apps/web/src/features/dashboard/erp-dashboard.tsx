"use client"
import { PageTitle } from "@/components/workspace/page-title"

import { GuardedLink as Link } from "@/components/shell/navigation-guard"
import { useDashboardPreferences } from "./use-dashboard-preferences"
import type { SetStateAction } from "react"
import { ArrowDown, ArrowUp, ArrowUpRight, BarChart3, Boxes, CircleDollarSign, ClipboardList, PackageCheck, Plus, ReceiptText, Route, ShoppingCart, Star, Trash2, Users, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { money, RecentActivity, SalesSeries, useDashboardData, type DashboardData } from "./dashboard-data"

const modules = [
  { title: "Cadastros", description: "Produtos, pessoas e tabelas fundamentais", href: "/cadastros", icon: Users },
  { title: "Vendas", description: "Pedidos, propostas, PDV e canais", href: "/vendas", icon: ShoppingCart },
  { title: "Estoque", description: "Saldos, movimentos e produção", href: "/estoque", icon: Boxes },
  { title: "Compras", description: "Pedidos, recebimentos e reposição", href: "/compras", icon: PackageCheck },
  { title: "Financeiro", description: "Obrigações, recebíveis e caixa", href: "/financeiro", icon: CircleDollarSign },
  { title: "Fiscal", description: "Documentos, eventos e configurações fiscais", href: "/fiscal", icon: ReceiptText },
  { title: "Logística", description: "Expedição, transportadoras e etiquetas", href: "/logistica", icon: Route },
  { title: "Serviços", description: "Ordens de serviço e contratos", href: "/servicos", icon: Wrench },
  { title: "Relatórios", description: "Indicadores consolidados por domínio", href: "/relatorios", icon: ClipboardList },
]

const dashboardLinks = [
  ["Dashboard geral", "/dashboards"], ["Vendas", "/dashboards/vendas"], ["Margem por pedido", "/dashboards/margem-pedidos"], ["Produtos", "/dashboards/produtos"], ["Clientes", "/dashboards/clientes"], ["Curva ABC", "/dashboards/curva-abc"], ["Metas", "/dashboards/metas"],
] as const

const favoriteOptions = [
  ["Pedidos de venda", "/vendas/pedidos"], ["Pedidos de compra", "/compras/pedidos"], ["Clientes e fornecedores", "/cadastros/clientes-fornecedores"], ["Produtos", "/cadastros/produtos"], ["Contas a receber", "/financeiro/contas-receber"], ["Contas a pagar", "/financeiro/contas-pagar"],
] as const

const periods = ["7D", "30D", "3M", "6M", "12M"]

export function ErpDashboard() {
  const preferences = useDashboardPreferences()
  const favorites = preferences.layout.favoritePaths.flatMap(href => {
    const option = favoriteOptions.find(([, path]) => path === href)
    return option ? [{ label: option[0], href: option[1] }] : []
  })
  const period = preferences.layout.period
  const summary = useDashboardData(period)
  const metricValue = (value: string | number | null | undefined) => summary.loading ? "Carregando…" : summary.error ? "Indisponível" : value == null ? "Sem permissão" : String(value)
  const charts = preferences.layout.charts
  const availableChart = ["Ticket médio", "Valor faturado", "Pedidos de venda"].find(chart => !charts.includes(chart))
  function setFavorites(change: SetStateAction<typeof favorites>) {
    preferences.update(value => ({ ...value, favoritePaths: (typeof change === "function" ? change(favorites) : change).map(item => item.href) }))
  }
  function setCharts(change: SetStateAction<string[]>) {
    preferences.update(value => ({ ...value, charts: typeof change === "function" ? change(value.charts) : change }))
  }
  function setPeriod(period: string) { preferences.update(value => ({ ...value, period })) }
  const availableFavorite = favoriteOptions.find(([label]) => !favorites.some((item) => item.label === label))

  function moveFavorite(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= favorites.length) return
    setFavorites((current) => {
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  return (
    <div className="erp-overview mx-auto w-full min-w-0 max-w-[1600px] px-4 pb-24 pt-6 lg:px-6">
      <header className="erp-overview-heading flex flex-col gap-5 rounded-2xl bg-primary px-5 py-6 text-primary-foreground sm:px-7 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0"><p className="text-xs font-medium uppercase tracking-[0.18em] opacity-80">SEU ESPAÇO DE TRABALHO</p><PageTitle className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Visão geral</PageTitle><p className="mt-3 max-w-2xl text-primary-foreground/85">Acesse os módulos e organize seus atalhos de trabalho.</p></div>
        <Link href="/cadastros/produtos" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-background px-5 py-3 text-sm font-semibold text-primary hover:bg-accent"><Plus aria-hidden="true" className="size-4" />Cadastrar produto</Link>
      </header>

      <nav aria-label="Comece uma operação" className="mt-5 grid gap-3 sm:grid-cols-3">
        {[["Novo pedido", "/vendas/pedidos/novo", ShoppingCart], ["Consultar estoque", "/estoque", Boxes], ["Acessar documentos fiscais", "/fiscal", ReceiptText]].map(([label, href, Icon]) => {
          const ActionIcon = Icon as typeof ShoppingCart
          return <Link key={href as string} href={href as string} className="group flex min-h-16 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-accent"><ActionIcon aria-hidden="true" className="size-5 text-primary" /><span className="flex-1">{label as string}</span><ArrowUpRight aria-hidden="true" className="size-4 text-muted-foreground" /></Link>
        })}
      </nav>
      <p className="mt-5 text-sm text-muted-foreground">Pedidos consideram o período selecionado. Saldos financeiros e cadastros mostram a posição atual da empresa.</p>
      {summary.error && <p className="mt-3 text-sm" role="status">{summary.error}</p>}

      <section className="mt-5 space-y-3 rounded-xl border p-4" aria-label="Preferências da página inicial">
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => void preferences.save()} disabled={!preferences.canSave}>Salvar página inicial</Button>
          <Button variant="outline" onClick={preferences.reload} disabled={preferences.busy || preferences.loading}>Recarregar página inicial</Button>
        </div>
        {preferences.loading && <p role="status" className="text-sm">Carregando sua página inicial…</p>}
        {preferences.error && <p role="alert" className="text-sm">{preferences.error} Suas alterações foram preservadas; confira a versão salva antes de tentar novamente.</p>}
        {preferences.message && <p role="status" className="text-sm">{preferences.message}</p>}
        {preferences.dirty && <p className="text-sm">Há alterações não salvas na página inicial.</p>}
      </section>

      <nav className="mt-5 flex gap-2 overflow-x-auto pb-1" aria-label="Áreas da página inicial">
        <Link className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" href="/">Visão geral</Link>
        <Link className="shrink-0 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted" href="/eventos">Eventos</Link>
        <Link className="shrink-0 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted" href="/financeiro/conta-digital">Conta Digital</Link>
      </nav>

      <div className="mt-6 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-5">

          <section className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between"><h2 className="font-semibold">Atalhos favoritos</h2><Star className="size-4 text-primary" /></div><p className="mt-1 text-xs text-muted-foreground">Ordem salva para sua conta nesta empresa ao confirmar as alterações.</p>
            <div className="mt-4 space-y-2">{favorites.map((favorite, index) => <div className="flex items-center gap-1 rounded-xl border border-border p-1.5" key={favorite.href}><Link className="min-w-0 flex-1 truncate px-2 py-1 text-sm font-medium hover:text-primary" href={favorite.href}>{favorite.label}</Link><Button aria-label={`Mover ${favorite.label} para cima`} disabled={!preferences.editable || index === 0} onClick={() => moveFavorite(index, -1)} size="icon-xs" variant="ghost"><ArrowUp /></Button><Button aria-label={`Mover ${favorite.label} para baixo`} disabled={!preferences.editable || index === favorites.length - 1} onClick={() => moveFavorite(index, 1)} size="icon-xs" variant="ghost"><ArrowDown /></Button><Button aria-label={`Remover ${favorite.label}`} disabled={!preferences.editable} onClick={() => setFavorites((items) => items.filter((item) => item.href !== favorite.href))} size="icon-xs" variant="ghost"><Trash2 /></Button></div>)}</div>
            {availableFavorite && <Button className="mt-3 w-full" disabled={!preferences.editable} onClick={() => setFavorites((items) => [...items, { label: availableFavorite[0], href: availableFavorite[1] }])} variant="outline"><Plus />Adicionar {availableFavorite[0]}</Button>}
          </section>
        </aside>

        <div className="erp-overview-body min-w-0">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric href="/vendas/pedidos" label="Pedidos no período" value={metricValue(summary.value?.sales?.orders)} /><Metric href="/financeiro/contas-receber" label="Saldo a receber" value={metricValue(summary.value ? money(summary.value.receivables) : undefined)} /><Metric href="/financeiro/contas-pagar" label="Saldo a pagar de compras" value={metricValue(summary.value ? money(summary.value.purchasePayables) : undefined)} /><Metric href="/cadastros/produtos" label="Produtos ativos" value={metricValue(summary.value?.products)} /></section>

          <section className="mt-6 rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><h2 className="text-lg font-semibold">Gráficos</h2><p className="mt-1 text-sm text-muted-foreground">Pedidos não cancelados por mês de criação; não representam faturamento.</p></div><div className="flex flex-wrap gap-2">{periods.map((item) => <Button disabled={!preferences.editable} aria-pressed={period === item} key={item} onClick={() => setPeriod(item)} variant={period === item ? "default" : "outline"}>{item}</Button>)}<Button disabled={!preferences.editable || !availableChart} onClick={() => { if (availableChart) setCharts((items) => [...items, availableChart]) }} variant="outline"><Plus />Adicionar gráfico</Button></div></div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">{charts.map((chart) => <ChartCard key={chart} disabled={!preferences.editable} data={summary.value} period={period} title={chart} onRemove={() => setCharts((items) => items.filter((item) => item !== chart))} />)}</div>
          </section>

          <section className="mt-6"><div className="mb-3"><h2 className="text-lg font-semibold">Dashboards</h2><p className="mt-1 text-sm text-muted-foreground">Análises especializadas por objetivo.</p></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{dashboardLinks.map(([label, href]) => <Link className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 hover:border-primary/40" href={href} key={href}><span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><BarChart3 className="size-4" /></span><strong className="min-w-0 flex-1 text-sm">{label}</strong><ArrowUpRight className="size-4 text-muted-foreground group-hover:text-primary" /></Link>)}</div></section>

          <div className="erp-overview-bottom mt-6">
            <section className="min-w-0" aria-label="Módulos"><div className="mb-3"><h2 className="text-lg font-semibold">Módulos</h2><p className="mt-1 text-sm text-muted-foreground">Atalhos para as áreas operacionais.</p></div><div className="erp-overview-modules">{modules.map((module) => { const Icon = module.icon; return <Link className="group flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-card p-5 transition hover:border-primary/40" href={module.href} key={module.title}><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" /></span><span className="min-w-0 flex-1"><strong className="block">{module.title}</strong><small className="mt-1 block text-sm text-muted-foreground">{module.description}</small></span><ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition group-hover:text-primary" /></Link>})}</div></section>
            <RecentActivity />
          </div>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, href, value }: { label: string; href: string; value: string }) {
  return <Link className="group min-w-0 rounded-2xl border border-border bg-card p-5 transition hover:border-primary/40" href={href}><span className="text-sm text-muted-foreground">{label}</span><strong className="mt-2 block text-lg">{value}</strong><small className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>Consultar registros</span><ArrowUpRight className="size-4 shrink-0 group-hover:text-primary" /></small></Link>
}

function ChartCard({ title, period, onRemove, disabled, data }: { title: string; period: string; onRemove: () => void; disabled: boolean; data: DashboardData | null }) {
  return <article className="min-w-0 rounded-xl border border-border bg-background p-4" aria-label={`Gráfico ${title}`}><div className="flex items-start justify-between gap-3"><p className="min-w-0 text-sm text-muted-foreground">{title}</p><Button aria-label={`Remover gráfico ${title}`} disabled={disabled} onClick={onRemove} size="icon-sm" variant="ghost"><Trash2 /></Button></div><p className="mt-3 text-xs text-muted-foreground">Período {period}</p>{title === "Valor faturado" ? <p className="mt-4 text-sm">Consulte os documentos autorizados em <Link className="text-primary underline" href="/fiscal/notas-saida">Notas fiscais</Link>. Valores de pedidos não equivalem a faturamento.</p> : data ? <SalesSeries data={data} average={title === "Ticket médio"} /> : <p className="mt-4 text-sm">Consulta de pedidos indisponível.</p> }</article>
}
