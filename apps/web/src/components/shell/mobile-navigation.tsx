"use client"

import dynamic from "next/dynamic"
import { GuardedLink as Link } from "@/components/shell/navigation-guard"
import { usePathname } from "next/navigation"
import { Boxes, LayoutGrid, Search, Settings } from "lucide-react"
import { useState } from "react"

const MobileModulesPanel = dynamic(() => import("./mobile-modules-panel").then((module) => module.MobileModulesPanel), { ssr: false })

export function MobileNavigation() {
  const pathname = usePathname(); const [modulesOpen, setModulesOpen] = useState(false); const [modulesLoaded, setModulesLoaded] = useState(false)
  const active = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href)
  return <><nav className="mobile-nav-bar fixed inset-x-0 bottom-0 z-50 grid grid-cols-4 border-t border-border bg-background/95 p-1 backdrop-blur min-[1600px]:hidden" aria-label="Navegação móvel"><Link className={`mobile-nav-link ${active("/") ? "text-primary" : ""}`} href="/" aria-current={active("/") ? "page" : undefined}><LayoutGrid />Início</Link><button className="mobile-nav-link" type="button" onClick={() => { setModulesLoaded(true); setModulesOpen(true) }}><Boxes />Módulos</button><button className="mobile-nav-link" type="button" onClick={() => window.dispatchEvent(new Event("erp-open-search"))}><Search />Buscar</button><Link className={`mobile-nav-link ${active("/preferencias") ? "text-primary" : ""}`} href="/preferencias" aria-current={active("/preferencias") ? "page" : undefined}><Settings />Preferências</Link></nav>{modulesLoaded && <MobileModulesPanel open={modulesOpen} onOpenChange={setModulesOpen} />}</>
}
