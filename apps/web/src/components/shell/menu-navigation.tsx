"use client"

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import { ArrowLeft, BarChart3, Boxes, BriefcaseBusiness, ChevronRight, History, House, LayoutGrid, Menu, PanelLeftClose, PanelLeftOpen, ShoppingCart, Truck, Users, Wallet, X } from "lucide-react"
import { GuardedLink as Link } from "./navigation-guard"
import { desktopMenus, moduleLinks, quickLinks } from "./navigation-catalog"
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

const icons = [BriefcaseBusiness, Users, ShoppingCart, Boxes, Wallet, Truck, BarChart3, LayoutGrid]
const menuDestinations = new Set(desktopMenus.flatMap(menu => menu.columns.flatMap(group => group.items.map(item => item.href))))
// Keep the supplemental destinations from the original mobile menu in the same catalog.
const menus = [...desktopMenus, {
  label: "Índice completo",
  columns: [
    { title: "Módulos", items: moduleLinks.map(([label, href]) => ({ label, href })) },
    { title: "Acesso rápido", items: quickLinks.filter(([, href]) => !menuDestinations.has(href) && !moduleLinks.some(([, path]) => path === href)).map(([label, href]) => ({ label, href })) },
  ],
}]
const MenuContext = createContext<{ open: boolean; show: (trigger: HTMLElement) => void } | null>(null)

function matches(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(href + "/"))
}

function currentArea(pathname: string) {
  const area = moduleLinks.find(([, href]) => href !== "/" && matches(pathname, href))?.[0]
  const named = desktopMenus.findIndex(menu => menu.label === area || menu.columns.some(group => group.title === area))
  if (named >= 0) return named
  return desktopMenus.flatMap((menu, index) => menu.columns.flatMap(group => group.items
    .filter(item => matches(pathname, item.href)).map(item => ({ index, length: item.href.length }))))
    .sort((a, b) => b.length - a.length)[0]?.index ?? (area && area !== "Histórico importado" ? menus.length - 1 : undefined)
}

function currentPage(pathname: string) {
  return menus.flatMap((menu, index) => menu.columns.flatMap(group => group.items
    .filter(item => matches(pathname, item.href)).map(item => ({ index, label: item.label, length: item.href.length }))))
    .sort((a, b) => b.length - a.length)[0]
}

function Options({ index, pathname, onNavigate }: { index: number; pathname: string; onNavigate: () => void }) {
  const active = menus[index].columns.flatMap(group => group.items).filter(item => matches(pathname, item.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href
  return <div className="erp-module-groups">
    {menus[index].columns.map(group => <section key={group.title}>
      <h3>{group.title}</h3>
      <ul>{group.items.map(item => <li key={item.href}>
        <Link href={item.href} onNavigate={onNavigate} className="erp-option" aria-current={item.href === active ? "page" : undefined}>{item.label}</Link>
      </li>)}</ul>
    </section>)}
  </div>
}

export function MenuNavigation({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const [screen, setScreen] = useState<number | null>(null)
  const [previousPath, setPreviousPath] = useState(pathname)
  const navigation = useRef<HTMLElement>(null)
  const panel = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const drawerTrigger = useRef<HTMLElement | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const moduleButtons = useRef<(HTMLButtonElement | null)[]>([])
  const previousScreen = useRef<number | null>(null)
  const active = currentArea(pathname)
  const activePage = currentPage(pathname)

  if (previousPath !== pathname) {
    setPreviousPath(pathname)
    setSelected(null)
    setOpen(false)
    setScreen(null)
  }

  function closePanel(restoreFocus = false) {
    setSelected(null)
    if (restoreFocus) trigger.current?.focus()
  }

  useEffect(() => {
    if (selected === null) return
    panel.current?.focus()
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !navigation.current?.contains(event.target)) closePanel(true)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closePanel(true) }
    }
    document.addEventListener("pointerdown", outside)
    document.addEventListener("keydown", escape)
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape) }
  }, [selected])

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 900px)")
    const change = () => { setSelected(null); setOpen(false); setScreen(null) }
    desktop.addEventListener("change", change)
    return () => desktop.removeEventListener("change", change)
  }, [])

  useEffect(() => {
    if (!open) { previousScreen.current = null; return }
    const previous = previousScreen.current
    previousScreen.current = screen
    if (screen === null && previous === null) return
    const frame = requestAnimationFrame(() => {
      if (screen !== null) heading.current?.focus()
      else if (previous !== null) moduleButtons.current[previous]?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open, screen])

  const homeLinks = <ul className="erp-home-links">
    {([{ label: "Visão geral", href: "/", Icon: House }, { label: "Histórico importado", href: "/historico", Icon: History }]).map(({ label, href, Icon }) => {
      return <li key={href}><Link href={href} className="erp-module-button" title={label} aria-label={label} aria-current={matches(pathname, href) ? "page" : undefined} onNavigate={() => { closePanel(); setOpen(false) }}><Icon aria-hidden="true" /><span>{label}</span></Link></li>
    })}
  </ul>

  return <MenuContext.Provider value={{ open, show: element => { drawerTrigger.current = element; setScreen(null); setOpen(true) } }}>
    <a className="skip-link" href="#conteudo-principal">Pular para o conteúdo</a>
    <div className="erp-workspace" data-collapsed={collapsed}>
      <TooltipProvider delay={250}>
        <nav ref={navigation} className="erp-sidebar" aria-label="Módulos do ERP">
          <Link href="/" className="erp-brand" aria-label="Visão geral do ERP"><span className="erp-brand-mark">A</span><span className="erp-brand-name"><strong>ERP Next</strong><small>Ávila Ops</small></span></Link>
          <div className="erp-sidebar-scroll">
            {homeLinks}
            <p className="erp-nav-caption">Módulos</p>
            <ul className="erp-module-list">{desktopMenus.map((menu, index) => {
              const Icon = icons[index]
              return <li key={menu.label}><Tooltip><TooltipTrigger render={<button type="button" className="erp-module-button" data-active={active === index} aria-label={menu.label} aria-expanded={selected === index} aria-controls={selected === index ? "erp-module-panel" : undefined} onClick={event => { trigger.current = event.currentTarget; setSelected(selected === index ? null : index) }} />}><Icon aria-hidden="true" /><span className="erp-module-copy"><span>{menu.label}</span>{active === index && activePage?.index === index && <small>{activePage.label}</small>}</span><ChevronRight className="erp-module-chevron" aria-hidden="true" /></TooltipTrigger>{collapsed && <TooltipContent side="right">{menu.label}{active === index && activePage?.index === index ? ` · ${activePage.label}` : ""}</TooltipContent>}</Tooltip></li>
            })}</ul>
            <div className="erp-index-entry"><button type="button" className="erp-module-button" data-active={active === menus.length - 1} aria-label="Índice completo" aria-expanded={selected === menus.length - 1} aria-controls={selected === menus.length - 1 ? "erp-module-panel" : undefined} onClick={event => { trigger.current = event.currentTarget; setSelected(selected === menus.length - 1 ? null : menus.length - 1) }}><LayoutGrid aria-hidden="true" /><span>Índice completo</span><ChevronRight className="erp-module-chevron" aria-hidden="true" /></button></div>
          </div>
          <div className="erp-sidebar-footer"><button type="button" className="erp-module-button" aria-label={collapsed ? "Expandir navegação" : "Recolher navegação"} aria-expanded={!collapsed} title={collapsed ? "Expandir navegação" : "Recolher navegação"} onClick={() => { closePanel(); setCollapsed(!collapsed) }}>{collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}<span>Recolher menu</span></button></div>
          {selected !== null && <section ref={panel} tabIndex={-1} id="erp-module-panel" className="erp-module-panel" aria-labelledby="erp-module-title">
            <div className="erp-panel-heading"><h2 id="erp-module-title">{menus[selected].label}</h2><button type="button" className="erp-menu-icon" aria-label="Fechar opções do módulo" onClick={() => closePanel(true)}><X aria-hidden="true" /></button></div>
            <Options index={selected} pathname={pathname} onNavigate={() => closePanel()} />
          </section>}
        </nav>
      </TooltipProvider>
      <div className="erp-workspace-body">{children}</div>
    </div>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="left" id="erp-mobile-menu" className="erp-navigation-drawer" showCloseButton={false} finalFocus={drawerTrigger}>
        <div className="erp-panel-heading">
          {screen !== null && <button type="button" className="erp-menu-icon" aria-label="Voltar aos módulos" onClick={() => { heading.current?.focus(); setScreen(null) }}><ArrowLeft aria-hidden="true" /></button>}
          <SheetTitle ref={heading} tabIndex={-1}>{screen === null ? "Menu do ERP" : menus[screen].label}</SheetTitle>
          <SheetClose className="erp-menu-icon" aria-label="Fechar menu"><X aria-hidden="true" /></SheetClose>
        </div>
        <nav className="erp-drawer-scroll" aria-label="Módulos e fluxos do ERP">
          {screen === null ? <>{homeLinks}<p className="erp-nav-caption">Módulos</p><ul className="erp-module-list">{desktopMenus.map((menu, index) => {
            const Icon = icons[index]
            return <li key={menu.label}><button ref={element => { moduleButtons.current[index] = element }} className="erp-module-button" data-active={active === index} type="button" aria-label={menu.label} onClick={() => { heading.current?.focus(); setScreen(index) }}><Icon aria-hidden="true" /><span className="erp-module-copy"><span>{menu.label}</span>{active === index && activePage?.index === index && <small>{activePage.label}</small>}</span><ChevronRight className="erp-module-chevron" aria-hidden="true" /></button></li>
          })}</ul><div className="erp-index-entry"><button ref={element => { moduleButtons.current[menus.length - 1] = element }} className="erp-module-button" data-active={active === menus.length - 1} type="button" onClick={() => { heading.current?.focus(); setScreen(menus.length - 1) }}><LayoutGrid aria-hidden="true" /><span>Índice completo</span><ChevronRight className="erp-module-chevron" aria-hidden="true" /></button></div></> : <Options index={screen} pathname={pathname} onNavigate={() => setOpen(false)} />}
        </nav>
      </SheetContent>
    </Sheet>
  </MenuContext.Provider>
}

export function MenuButton() {
  const menu = useContext(MenuContext)
  if (!menu) throw new Error("MenuButton precisa de MenuNavigation")
  return <button type="button" className="erp-menu-trigger" aria-label="Abrir menu" aria-haspopup="dialog" aria-expanded={menu.open} aria-controls="erp-mobile-menu" onClick={event => menu.show(event.currentTarget)}><Menu aria-hidden="true" /><span>Menu</span></button>
}
