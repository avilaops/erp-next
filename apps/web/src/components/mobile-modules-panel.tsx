"use client"

import { GuardedLink as Link } from "@/components/navigation-guard"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

import { moduleLinks as modules, quickLinks as quickFlows } from "@/components/navigation-catalog"

export function MobileModulesPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const close = () => onOpenChange(false)
  const links = (items: readonly (readonly [string, string])[]) => items.map(([label, href]) => (
    <Link className="inline-flex min-h-10 items-center justify-center rounded-lg border border-input bg-background px-3 py-2 text-center text-sm font-medium transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={href} key={href} onNavigate={close}>{label}</Link>
  ))

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Módulos do ERP</DialogTitle><DialogDescription>Acesse os módulos e os fluxos mais usados.</DialogDescription></DialogHeader><nav className="space-y-5" aria-label="Módulos e fluxos do ERP"><section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Módulos</h3><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{links(modules)}</div></section><section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Acesso rápido</h3><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{links(quickFlows)}</div></section></nav></DialogContent></Dialog>
}
