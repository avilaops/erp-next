import { GuardedLink as Link, NavigationGuardProvider } from "@/components/shell/navigation-guard"
import { Suspense } from "react"
import { headers } from "next/headers"
import { PreferencesCommand } from "@/features/preferences/search/preferences-command"
import { MenuButton, MenuNavigation } from "@/components/shell/menu-navigation"
import { HeaderTools } from "@/components/shell/header-tools"
import { DemonstrationPreview } from "@/components/feedback/demonstration-preview"

export function AppShell({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<p role="status" className="p-6 text-sm text-muted-foreground">Preparando o ERP…</p>}><WorkspaceFrame>{children}</WorkspaceFrame></Suspense>
}

async function WorkspaceFrame({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get("x-erp-path") || "/"
  if (pathname === "/entrar") return <>{children}</>
  return <WorkspaceNavigation><DemonstrationPreview>{children}</DemonstrationPreview></WorkspaceNavigation>
}

function WorkspaceNavigation({ children }: { children: React.ReactNode }) {
  return <NavigationGuardProvider><MenuNavigation>
    <header className="erp-header">
      <MenuButton />
      <Link href="/" className="erp-header-brand" aria-label="Visão geral do ERP"><strong>ERP Next</strong></Link>
      <PreferencesCommand />
      <HeaderTools />
    </header>
    <main id="conteudo-principal" className="erp-content">{children}</main>
  </MenuNavigation></NavigationGuardProvider>
}
