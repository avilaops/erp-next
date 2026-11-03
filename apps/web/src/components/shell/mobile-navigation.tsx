"use client"

import dynamic from "next/dynamic"
import { GuardedLink as Link } from "@/components/shell/navigation-guard"
import { usePathname } from "next/navigation"
import { LayoutGrid, Menu, Search, Settings } from "lucide-react"
import { createContext, useContext, useRef, useState, useSyncExternalStore, type ReactNode } from "react"

const MobileModulesPanel = dynamic(() => import("./mobile-modules-panel").then((module) => module.MobileModulesPanel), { ssr: false })
const MobileMenuContext = createContext<{ open: boolean; openMenu: (trigger: HTMLElement) => void } | null>(null)
const subscribeHydration = () => () => {}

export function MobileMenuProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  function openMenu(trigger: HTMLElement) {
    returnFocus.current = trigger
    setLoaded(true); setOpen(true)
  }
  function changeOpen(open: boolean) {
    setOpen(open)
    if (!open) requestAnimationFrame(() => returnFocus.current?.focus())
  }
  return <MobileMenuContext.Provider value={{ open, openMenu }}>{children}{loaded && <MobileModulesPanel open={open} onOpenChange={changeOpen} />}</MobileMenuContext.Provider>
}

function useMobileMenu() {
  const menu = useContext(MobileMenuContext)
  if (!menu) throw new Error("O menu móvel precisa de MobileMenuProvider")
  return menu
}

export function MobileMenuButton() {
  const { open, openMenu } = useMobileMenu()
  return <button className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-xl text-foreground hover:bg-muted min-[1600px]:hidden" type="button" aria-label="Abrir menu" aria-haspopup="dialog" aria-expanded={open} aria-controls="erp-mobile-menu" onClick={event => openMenu(event.currentTarget)}><Menu className="size-5" aria-hidden="true" /></button>
}

export function MobileNavigation() {
  const pathname = usePathname()
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false)
  const { open, openMenu } = useMobileMenu()
  const active = (href: string) => hydrated && (href === "/" ? pathname === "/" : pathname.startsWith(href))
  return <nav className="mobile-nav-bar fixed inset-x-0 bottom-0 z-50 grid grid-cols-4 border-t border-border bg-background/95 p-1 backdrop-blur min-[1600px]:hidden" aria-label="Navegação móvel"><Link className={`mobile-nav-link ${active("/") ? "text-primary" : ""}`} href="/" aria-current={active("/") ? "page" : undefined}><LayoutGrid />Início</Link><button className="mobile-nav-link" type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls="erp-mobile-menu" onClick={event => openMenu(event.currentTarget)}><Menu />Menu</button><button className="mobile-nav-link" type="button" onClick={() => window.dispatchEvent(new Event("erp-open-search"))}><Search />Buscar</button><Link className={`mobile-nav-link ${active("/preferencias") ? "text-primary" : ""}`} href="/preferencias" aria-current={active("/preferencias") ? "page" : undefined}><Settings />Preferências</Link></nav>
}
