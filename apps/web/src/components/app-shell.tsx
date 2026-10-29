import Link from "next/link"
import { Suspense } from "react"
import { headers } from "next/headers"
import {
  Bell,
  ChevronDown,
  CircleHelp,
  LayoutGrid,
  LogOut,
  Settings,
  Sparkles,
} from "lucide-react"
import { PreferencesCommand } from "@/features/preferences-search/preferences-command"
import { MobileNavigation } from "@/components/mobile-navigation"
import { DesktopNavigation } from "@/components/desktop-navigation"

const menus = [
  {
    label: "Meu Negócio",
    columns: [
      { title: "Dashboards", items: [{ label: "Dashboard geral", href: "/dashboards" }, { label: "Dashboard de vendas", href: "/dashboards/vendas" }, { label: "Margem por pedido", href: "/dashboards/margem-pedidos" }, { label: "Dashboard de produtos", href: "/dashboards/produtos" }, { label: "Dashboard de clientes", href: "/dashboards/clientes" }, { label: "Curva ABC", href: "/dashboards/curva-abc" }, { label: "Metas", href: "/dashboards/metas" }] },
      { title: "Central de trabalho", items: [{ label: "Eventos", href: "/eventos" }, { label: "Notificações", href: "/notificacoes" }, { label: "Aplicativos", href: "/aplicativos" }, { label: "Assistente", href: "/assistente" }, { label: "Novidades", href: "/novidades" }, { label: "Plano e limites", href: "/preferencias/plano" }] },
    ],
  },
  {
    label: "Cadastros",
    columns: [
      { title: "Operação", items: [{ label: "Produtos", href: "/cadastros/produtos" }, { label: "Clientes e fornecedores", href: "/cadastros/clientes-fornecedores" }, { label: "Vendedores", href: "/cadastros/vendedores" }, { label: "Funcionários", href: "/cadastros/funcionarios" }] },
      { title: "Ferramentas", items: [{ label: "Contas financeiras", href: "/cadastros/contas-financeiras" }, { label: "Categorias financeiras", href: "/cadastros/categorias-financeiras" }, { label: "Categorias de produtos", href: "/cadastros/categorias-produtos" }, { label: "Listas de preços", href: "/cadastros/listas-precos" }, { label: "Formas de pagamento", href: "/cadastros/formas-pagamento" }] },
    ],
  },
  {
    label: "Vendas",
    columns: [
      { title: "Operação", items: [{ label: "Propostas", href: "/vendas/propostas" }, { label: "Pedidos de venda", href: "/vendas/pedidos" }, { label: "PDV", href: "/vendas/pdv" }, { label: "Garantias", href: "/vendas/garantias" }] },
      { title: "Canais e importação", items: [{ label: "Loja virtual", href: "/vendas/loja-virtual" }, { label: "Anúncios", href: "/vendas/anuncios" }, { label: "Importar pedidos", href: "/vendas/importacao" }, { label: "Relatórios de vendas", href: "/vendas/relatorios" }] },
      { title: "Documentos fiscais", items: [{ label: "NF-e", href: "/fiscal/notas-saida" }, { label: "NFC-e", href: "/fiscal/nfce" }, { label: "Notas fiscais de entrada", href: "/compras/notas-entrada" }] },
    ],
  },
  {
    label: "Estoque",
    columns: [
      { title: "Compras", items: [{ label: "Pedidos de compra", href: "/compras/pedidos" }, { label: "Notas fiscais de entrada", href: "/compras/notas-entrada" }, { label: "Fornecedores", href: "/cadastros/clientes-fornecedores" }, { label: "Sugestões de compra", href: "/compras/sugestoes" }, { label: "Check-in de recebimentos", href: "/compras/recebimentos" }] },
      { title: "Estoque", items: [{ label: "Saldos", href: "/estoque/saldos" }, { label: "Lançamentos de estoque", href: "/estoque/lancamentos" }, { label: "Conferência de estoque", href: "/estoque/inventarios" }, { label: "Ordens de produção", href: "/estoque/ordens-producao" }, { label: "Depósitos", href: "/estoque/depositos" }, { label: "Relatórios de estoque", href: "/relatorios/estoque" }] },
    ],
  },
  {
    label: "Financeiro",
    columns: [
      { title: "Operação", items: [{ label: "Contas a receber", href: "/financeiro/contas-receber" }, { label: "Contas a pagar", href: "/financeiro/contas-pagar" }, { label: "Caixa", href: "/financeiro/controle-caixa" }, { label: "Caixas e bancos", href: "/financeiro/caixas-bancos" }] },
      { title: "Gestão", items: [{ label: "Ficha financeira", href: "/financeiro/ficha-financeira" }, { label: "Remessas e retornos", href: "/financeiro/remessas-retornos" }, { label: "Comissões", href: "/financeiro/comissoes" }, { label: "Faturamento agrupado", href: "/financeiro/faturamento-agrupado" }] },
      { title: "Contabilidade e soluções", items: [{ label: "Tributos e guias", href: "/financeiro/tributos" }, { label: "Espaço do contador", href: "/financeiro/contador" }, { label: "Conta Digital", href: "/financeiro/conta-digital" }, { label: "Relatórios financeiros", href: "/financeiro/relatorios" }] },
    ],
  },
  {
    label: "Operações",
    columns: [
      { title: "Logística", items: [{ label: "Objetos de postagem", href: "/logistica/postagens" }, { label: "Logística reversa", href: "/logistica/reversa" }, { label: "Checkout de pedidos", href: "/logistica/checkout" }, { label: "Etiquetas", href: "/logistica/etiquetas" }, { label: "Ávila Envios", href: "/logistica/envios" }] },
      { title: "Serviços", items: [{ label: "Contratos", href: "/servicos/contratos" }, { label: "Ordens de serviço", href: "/servicos/ordens" }, { label: "CT-e", href: "/servicos/cte" }, { label: "Notas de serviço", href: "/servicos/notas" }, { label: "Cobranças", href: "/servicos/cobrancas" }] },
    ],
  },
  {
    label: "Relatórios",
    columns: [
      { title: "Visão executiva", items: [{ label: "Todos os relatórios", href: "/relatorios" }, { label: "Vendas", href: "/relatorios/vendas" }, { label: "Estoque", href: "/relatorios/estoque" }, { label: "Financeiro", href: "/relatorios/financeiro" }] },
      { title: "Operação", items: [{ label: "Serviços", href: "/relatorios/servicos" }, { label: "Auditoria", href: "/relatorios/auditoria" }, { label: "Relatórios de vendas", href: "/vendas/relatorios" }, { label: "Relatórios financeiros", href: "/financeiro/relatorios" }, { label: "Relatórios de serviços", href: "/servicos/relatorios" }] },
    ],
  },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<p role="status" className="p-6 text-sm text-muted-foreground">Preparando o ERP…</p>}><WorkspaceFrame>{children}</WorkspaceFrame></Suspense>
}

async function WorkspaceFrame({ children }: { children: React.ReactNode }) {
  if ((await headers()).get("x-erp-path") === "/entrar") return <>{children}</>
  return <WorkspaceNavigation>{children}</WorkspaceNavigation>
}

function WorkspaceNavigation({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <a className="skip-link" href="#conteudo-principal">Pular para o conteúdo</a>
      <header className="sticky top-0 z-50 border-b border-border/80 bg-background/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-2 px-4 lg:px-6">
          <Link className="mr-2 flex shrink-0 items-center gap-2" href="/">
            <span className="grid size-9 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-sm">A</span>
            <span className="hidden leading-tight sm:block"><strong className="block text-sm">ERP Next</strong><small className="text-xs text-muted-foreground">Avila Ops</small></span>
          </Link>

          <DesktopNavigation>
            <Link className="top-nav-link" href="/">Visão geral</Link>
            <Link className="top-nav-link" href="/historico">Histórico importado</Link>
            {menus.map((menu) => (
              <details className="group h-full" name="erp-main-navigation" key={menu.label}>
                <summary className="top-nav-link h-full cursor-pointer list-none gap-1">{menu.label}<ChevronDown className="size-3.5 transition group-open:rotate-180" /></summary>
                <div className={`absolute top-[calc(100%+1px)] grid max-h-[calc(100dvh-6rem)] max-w-[calc(100vw-2rem)] gap-8 overflow-y-auto rounded-b-2xl border border-t-0 border-border bg-popover p-6 text-popover-foreground shadow-2xl ${menu.label === "Relatórios" ? "right-0" : "left-0"} ${menu.columns.length === 3 ? "w-[780px] grid-cols-3" : menu.columns.length === 1 ? "w-[320px] grid-cols-1" : "w-[560px] grid-cols-2"}`}>
                  {menu.columns.map((column) => (
                    <div key={column.title}><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{column.title}</p><div className="grid gap-1">{column.items.map((item) => "href" in item && item.href ? <Link className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground" href={item.href} key={item.label}>{item.label}</Link> : <span className="rounded-lg px-3 py-2 text-sm text-muted-foreground" key={item.label}>{item.label}</span>)}</div></div>
                  ))}
                </div>
              </details>
            ))}
          </DesktopNavigation>

          <PreferencesCommand />

          <div className="flex items-center gap-1">
            <Link className="icon-action accent" href="/assistente" aria-label="Abrir assistente"><Sparkles className="size-4" /></Link>
            <Link className="icon-action hidden sm:grid" href="/aplicativos" aria-label="Aplicativos"><LayoutGrid className="size-4" /></Link>
            <Link className="icon-action" href="/notificacoes" aria-label="Notificações"><Bell className="size-4" /></Link>
            <Link className="icon-action hidden sm:grid" href="/ajuda" aria-label="Ajuda"><CircleHelp className="size-4" /></Link>
            <Link className="icon-action" href="/preferencias/empresa" aria-label="Preferências"><Settings className="size-4" /></Link>
            <Link className="ml-1 flex items-center gap-2 rounded-xl p-1.5 hover:bg-muted" href="/empresas" aria-label="Suas empresas">
              <span className="text-sm font-medium">Empresas</span>
            </Link>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" title="Encerrar a sessão deste ERP">
                <LogOut className="size-4" aria-hidden="true" />Sair
              </button>
            </form>
          </div>
        </div>
      </header>

      <main id="conteudo-principal">{children}</main>
      <Suspense fallback={<div className="fixed inset-x-0 bottom-0 z-50 h-16 border-t border-border bg-background min-[1600px]:hidden" aria-hidden="true" />}>
        <MobileNavigation />
      </Suspense>
    </div>
  )
}
