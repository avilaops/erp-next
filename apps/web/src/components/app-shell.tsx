import { GuardedLink as Link, NavigationGuardProvider } from "@/components/navigation-guard"
import { Suspense } from "react"
import { headers } from "next/headers"
import {
  Bell,
  Building2,
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

import { desktopMenus as menus } from "@/components/navigation-catalog"
import { DemonstrationPreview } from "@/components/demonstration-preview"

export function AppShell({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<p role="status" className="p-6 text-sm text-muted-foreground">Preparando o ERP…</p>}><WorkspaceFrame>{children}</WorkspaceFrame></Suspense>
}

async function WorkspaceFrame({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get("x-erp-path") || "/"
  if (pathname === "/entrar") return <>{children}</>
  return <WorkspaceNavigation><DemonstrationPreview>{children}</DemonstrationPreview></WorkspaceNavigation>
}

function WorkspaceNavigation({ children }: { children: React.ReactNode }) {
  return (
    <NavigationGuardProvider><div className="min-h-screen bg-background text-foreground">
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
            <Link className="ml-1 flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl p-1.5 hover:bg-muted" href="/empresas" aria-label="Suas empresas">
              <Building2 className="size-5 min-[360px]:hidden" aria-hidden="true" /><span className="hidden text-sm font-medium min-[360px]:inline">Empresas</span>
            </Link>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" title="Encerrar a sessão deste ERP">
                <LogOut className="size-4" aria-hidden="true" />Sair
              </button>
            </form>
          </div>
        </div>
      </header>

      <main id="conteudo-principal" className="erp-content">{children}</main>
      <Suspense fallback={<div className="mobile-nav-bar fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background min-[1600px]:hidden" aria-hidden="true" />}>
        <MobileNavigation />
      </Suspense>
    </div></NavigationGuardProvider>
  )
}
