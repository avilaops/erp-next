"use client"

import { usePathname } from "next/navigation"
import { ChevronDown, ChevronLeft, ExternalLink, Building2 } from "lucide-react"
import { useState } from "react"
import { GuardedLink as Link } from "@/components/navigation-guard"
import { accountHref, accountSections, type AccountSection } from "./account-navigation"

export function AccountShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const groups: { label: string; items: { label: string; href: string; external?: boolean }[] }[] = [
    { label: "Minha conta", items: [
      { label: "Dados da empresa", href: "/preferencias/empresa/dados" },
      { label: accountSections.socio, href: accountHref("socio") },
      { label: "Alterar senha", href: "/api/auth/account-password", external: true },
      { label: accountSections.horarios, href: accountHref("horarios") },
    ] },
    ...([ ["Pagamento", ["pagamento", "extrato"]], ["Gerenciamento", ["armazenamento", "importacoes"]], ["Preferências da conta", ["plano", "cancelamento"]] ] as [string, AccountSection[]][]).map(([label, sections]) => ({ label, items: sections.map(section => ({ label: accountSections[section], href: accountHref(section) })) })),
  ]
  return <div className="mx-auto max-w-[1680px] px-4 pb-28 pt-6 lg:px-8">
    <Link href="/preferencias?categoria=empresa" className="mb-5 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" />Preferências</Link>
    <header className="mb-7 flex items-center gap-4 border-b border-border pb-6">
      <span className="rounded-xl bg-primary/10 p-3 text-primary"><Building2 className="size-6" /></span>
      <div><p className="text-sm text-muted-foreground">Preferências / Empresa</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Alterar dados da empresa</h1></div>
    </header>
    <div className="grid items-start gap-6 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-8">
      <nav aria-label="Conta da empresa" className="rounded-xl border border-border bg-card p-3 lg:sticky lg:top-24">
        <button type="button" aria-label="Navegar nas configurações da empresa" aria-expanded={menuOpen} aria-controls="account-menu" className="flex min-h-11 w-full items-center justify-between gap-3 px-2 text-left text-sm font-medium lg:hidden" onClick={() => setMenuOpen(value => !value)}>{groups.flatMap(group => group.items).find(item => item.href === pathname)?.label || "Seções da conta"}<ChevronDown className={`size-4 shrink-0 transition ${menuOpen ? "rotate-180" : ""}`} /></button>
        <div id="account-menu" className={`${menuOpen ? "grid" : "hidden"} grid-cols-1 gap-5 pt-3 sm:grid-cols-2 lg:grid lg:grid-cols-1 lg:pt-0`}>
        {groups.map(group => <div key={group.label}><p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p><ul className="space-y-1">{group.items.map(item => <li key={item.href}><Link href={item.href} prefetch={!item.external} onNavigate={() => setMenuOpen(false)} aria-current={pathname === item.href ? "page" : undefined} className={`flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-muted ${pathname === item.href ? "bg-primary/10 font-semibold text-primary" : "text-foreground"}`}>{item.label}{item.external && <ExternalLink className="size-3.5 shrink-0" aria-label="Ávila Auth" />}</Link></li>)}</ul></div>)}
        </div>
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  </div>
}
