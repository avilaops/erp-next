"use client"

import Link from "next/link"
import { useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpRight, BarChart3, Boxes, CircleDollarSign, ClipboardList, FileInput, PackageCheck, Plus, ReceiptText, Route, ShoppingCart, Star, Trash2, Users, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"

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
  const [favorites, setFavorites] = useState(() => favoriteOptions.slice(0, 5).map(([label, href]) => ({ label, href })))
  const [period, setPeriod] = useState("6M")
  const [charts, setCharts] = useState(["Ticket médio", "Valor faturado"])
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
    <div className="mx-auto w-full min-w-0 max-w-[1600px] px-4 pb-24 pt-6 lg:px-6">
      <header className="flex flex-col gap-5 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0"><p className="text-sm font-medium text-primary">Ávila Ops</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Visão geral</h1><p className="mt-3 max-w-2xl text-muted-foreground">Acesse os módulos e organize seus atalhos de trabalho.</p></div>
        <p className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground">Os indicadores desta página aguardam conexão com os dados da empresa.</p>
      </header>

      <nav className="mt-5 flex gap-2 overflow-x-auto pb-1" aria-label="Áreas da página inicial">
        <Link className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" href="/">Visão geral</Link>
        <Link className="shrink-0 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted" href="/eventos">Eventos</Link>
        <Link className="shrink-0 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted" href="/financeiro/conta-digital">Conta Digital</Link>
      </nav>

      <div className="mt-6 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-5">
          <section className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium text-primary">Marketplaces</p><h2 className="mt-1 font-semibold">Importações de pedidos</h2></div><FileInput className="size-5 text-muted-foreground" /></div>
            <p className="mt-5 text-sm text-muted-foreground">Contagem e limite indisponíveis. A integração de importações ainda não está conectada.</p>
          </section>

          <section className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between"><h2 className="font-semibold">Atalhos favoritos</h2><Star className="size-4 text-primary" /></div><p className="mt-1 text-xs text-muted-foreground">Ordem mantida somente nesta sessão.</p>
            <div className="mt-4 space-y-2">{favorites.map((favorite, index) => <div className="flex items-center gap-1 rounded-xl border border-border p-1.5" key={favorite.href}><Link className="min-w-0 flex-1 truncate px-2 py-1 text-sm font-medium hover:text-primary" href={favorite.href}>{favorite.label}</Link><Button aria-label={`Mover ${favorite.label} para cima`} disabled={index === 0} onClick={() => moveFavorite(index, -1)} size="icon-xs" variant="ghost"><ArrowUp /></Button><Button aria-label={`Mover ${favorite.label} para baixo`} disabled={index === favorites.length - 1} onClick={() => moveFavorite(index, 1)} size="icon-xs" variant="ghost"><ArrowDown /></Button><Button aria-label={`Remover ${favorite.label}`} onClick={() => setFavorites((items) => items.filter((item) => item.href !== favorite.href))} size="icon-xs" variant="ghost"><Trash2 /></Button></div>)}</div>
            {availableFavorite && <Button className="mt-3 w-full" onClick={() => setFavorites((items) => [...items, { label: availableFavorite[0], href: availableFavorite[1] }])} variant="outline"><Plus />Adicionar {availableFavorite[0]}</Button>}
          </section>
        </aside>

        <div className="min-w-0">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric href="/vendas/pedidos" label="Pedidos de venda" /><Metric href="/financeiro/contas-receber" label="Contas a receber" /><Metric href="/financeiro/contas-pagar" label="Contas a pagar" /><Metric href="/fiscal/notas-saida" label="Notas fiscais" /></section>

          <section className="mt-6 rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><h2 className="text-lg font-semibold">Gráficos</h2><p className="mt-1 text-sm text-muted-foreground">Seleção local de indicadores. Séries ainda não conectadas.</p></div><div className="flex flex-wrap gap-2">{periods.map((item) => <Button aria-pressed={period === item} key={item} onClick={() => setPeriod(item)} variant={period === item ? "default" : "outline"}>{item}</Button>)}<Button disabled={charts.length >= 3 || charts.includes("Pedidos de venda")} onClick={() => setCharts((items) => [...items, "Pedidos de venda"])} variant="outline"><Plus />Adicionar gráfico</Button></div></div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">{charts.map((chart) => <ChartCard key={chart} period={period} title={chart} onRemove={() => setCharts((items) => items.filter((item) => item !== chart))} />)}</div>
          </section>

          <section className="mt-6"><div className="mb-3"><h2 className="text-lg font-semibold">Dashboards</h2><p className="mt-1 text-sm text-muted-foreground">Análises especializadas por objetivo.</p></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{dashboardLinks.map(([label, href]) => <Link className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 hover:border-primary/40" href={href} key={href}><span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><BarChart3 className="size-4" /></span><strong className="min-w-0 flex-1 text-sm">{label}</strong><ArrowUpRight className="size-4 text-muted-foreground group-hover:text-primary" /></Link>)}</div></section>

          <div className="mt-6 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <section><div className="mb-3"><h2 className="text-lg font-semibold">Módulos</h2><p className="mt-1 text-sm text-muted-foreground">Atalhos para as áreas operacionais.</p></div><div className="grid gap-3 sm:grid-cols-2">{modules.map((module) => { const Icon = module.icon; return <Link className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-5 transition hover:border-primary/40" href={module.href} key={module.title}><span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" /></span><span className="min-w-0 flex-1"><strong className="block">{module.title}</strong><small className="mt-1 block text-sm text-muted-foreground">{module.description}</small></span><ArrowUpRight className="size-4 text-muted-foreground transition group-hover:text-primary" /></Link>})}</div></section>
            <aside className="min-w-0 rounded-2xl border border-border bg-card"><div className="border-b border-border p-5"><h2 className="font-semibold">Atividade recente</h2></div><p className="p-5 text-sm text-muted-foreground">O histórico de atividades ainda não está conectado. Nenhum evento é apresentado nesta página.</p></aside>
          </div>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, href }: { label: string; href: string }) {
  return <Link className="group min-w-0 rounded-2xl border border-border bg-card p-5 transition hover:border-primary/40" href={href}><span className="text-sm text-muted-foreground">{label}</span><strong className="mt-2 block text-lg">Indisponível</strong><small className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>Aguardando dados da empresa</span><ArrowUpRight className="size-4 shrink-0 group-hover:text-primary" /></small></Link>
}

function ChartCard({ title, period, onRemove }: { title: string; period: string; onRemove: () => void }) {
  return <article className="min-w-0 rounded-xl border border-border bg-background p-4" aria-label={`Gráfico ${title}`}><div className="flex items-start justify-between gap-3"><p className="min-w-0 text-sm text-muted-foreground">{title}</p><Button aria-label={`Remover gráfico ${title}`} onClick={onRemove} size="icon-sm" variant="ghost"><Trash2 /></Button></div><p className="mt-5 text-sm text-muted-foreground">Série indisponível para o período {period}. A fonte de dados ainda não está conectada.</p></article>
}
