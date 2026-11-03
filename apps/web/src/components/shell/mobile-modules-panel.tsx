"use client"

import { GuardedLink as Link } from "@/components/shell/navigation-guard"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ChevronDown } from "lucide-react"
import { usePathname } from "next/navigation"

import { desktopMenus, moduleLinks as modules, quickLinks as quickFlows } from "@/components/shell/navigation-catalog"

const menuDestinations = new Set(desktopMenus.flatMap(menu => menu.columns.flatMap(column => column.items.map(item => item.href))))
const additionalQuickFlows = quickFlows.filter(([, href]) => !menuDestinations.has(href) && !modules.some(([, path]) => path === href))

export function MobileModulesPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const pathname = usePathname()
  const close = () => onOpenChange(false)
  const links = (items: readonly (readonly [string, string])[]) => items.map(([label, href]) => (
    <Link className="inline-flex min-h-10 items-center justify-center rounded-lg border border-input bg-background px-3 py-2 text-center text-sm font-medium transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={href} key={href} onNavigate={close}>{label}</Link>
  ))

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent id="erp-mobile-menu" className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>Menu do ERP</DialogTitle><DialogDescription>Escolha uma área para acessar todas as suas opções.</DialogDescription></DialogHeader>
      <nav className="min-w-0 space-y-5" aria-label="Módulos e fluxos do ERP">
        <div className="grid grid-cols-2 gap-2">{links([["Visão geral", "/"], ["Histórico importado", "/historico"]])}</div>
        <div className="divide-y divide-border rounded-xl border border-border">
          {desktopMenus.map(menu => <details key={menu.label} name="erp-mobile-navigation" className="group" open={menu.columns.some(column => column.items.some(item => pathname === item.href || pathname.startsWith(item.href + "/")))}>
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {menu.label}<ChevronDown className="size-4 shrink-0 transition group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="space-y-4 px-3 pb-4">
              {menu.columns.map(column => <section key={column.title}>
                <h3 className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{column.title}</h3>
                <div className="mt-1 grid">{column.items.map(item => <Link key={item.href} href={item.href} onNavigate={close} aria-current={pathname === item.href ? "page" : undefined} className="flex min-h-11 items-center rounded-lg px-2 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary">{item.label}</Link>)}</div>
              </section>)}
            </div>
          </details>)}
        </div>
        <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Módulos</h3><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{links(modules)}</div></section>
        {additionalQuickFlows.length > 0 && <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Acesso rápido</h3><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{links(additionalQuickFlows)}</div></section>}
      </nav>
    </DialogContent>
  </Dialog>
}
