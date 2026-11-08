"use client"

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { ArrowLeft, BarChart3, Boxes, BriefcaseBusiness, ChevronRight, History, House, LayoutGrid, Menu, PanelLeftClose, PanelLeftOpen, ShoppingCart, Truck, Users, Wallet, X, PackageCheck, ReceiptText, Settings2, Wrench, type LucideIcon } from "lucide-react"
import { GuardedLink as Link } from "./navigation-guard"
import { CategoryButton } from "./category-button"
import { desktopMenus, moduleLinks, navigationDestinations } from "./navigation-catalog"
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

const icons: Record<string, LucideIcon> = { "Meu Negócio": BriefcaseBusiness, Cadastros: Users, Vendas: ShoppingCart, Estoque: Boxes, Compras: PackageCheck, Financeiro: Wallet, Fiscal: ReceiptText, "Logística": Truck, Serviços: Wrench, Relatórios: BarChart3, Preferências: Settings2 }
const modulePaths = new Set<string>(moduleLinks.map(([, href]) => href))
const indexDestinations = navigationDestinations.filter(item => !modulePaths.has(item.href))
const indexGroups = [...new Set(indexDestinations.map(item => item.category))].map(title => ({
  title,
  items: indexDestinations.filter(item => item.category === title),
}))
const menus = [...desktopMenus, {
  label: "Índice completo",
  columns: [
    { title: "Módulos", items: moduleLinks.map(([label, href]) => ({ label, href })) },
    ...indexGroups,
  ],
}]
const MenuContext = createContext<{ open: boolean; show: (trigger: HTMLElement) => void } | null>(null)

function matches(pathname: string, href: string) {
  const [path, query] = pathname.split("?")
  const [destination, expectedQuery] = href.split("?")
  if (path !== destination && !(destination !== "/" && path.startsWith(destination + "/"))) return false
  const current = new URLSearchParams(query)
  return [...new URLSearchParams(expectedQuery)].every(([key, value]) => current.get(key) === value)
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
    {menus[index].columns.map(group => <section key={group.title || group.items[0]?.href}>
      {group.title && <h3>{group.title}</h3>}
      <ul>{group.items.map(item => <li key={item.href}>
        <Link href={item.href} onNavigate={onNavigate} className="erp-option" aria-current={item.href === active ? "page" : undefined}>{item.label}</Link>
      </li>)}</ul>
    </section>)}
  </div>
}

export function MenuNavigation({ children }: { children: ReactNode }) {
  const routePathname = usePathname()
  const preferences = routePathname === "/preferencias" || routePathname.startsWith("/preferencias/")
  const category = useSearchParams().get("categoria")
  const pathname = routePathname === "/preferencias" && category ? `${routePathname}?${new URLSearchParams({ categoria: category })}` : routePathname
  const [collapsed, setCollapsed] = useState(false)
  const [selected, setSelected] = useState<number | null>(() => currentArea(pathname) ?? null)
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
    setSelected(preferences ? null : currentArea(pathname) ?? null)
    setOpen(false)
    setScreen(null)
  }

  function closePanel(restoreFocus = false) {
    setSelected(null)
    if (restoreFocus) trigger.current?.focus()
  }

  useEffect(() => {
    if (selected === null) return
    if (collapsed) panel.current?.focus()
    const outside = (event: PointerEvent) => {
      if (collapsed && event.target instanceof Node && !navigation.current?.contains(event.target)) closePanel(true)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closePanel(true) }
    }
    document.addEventListener("pointerdown", outside)
    document.addEventListener("keydown", escape)
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape) }
  }, [selected, collapsed])

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 900px)")
    const change = () => { setSelected(currentArea(pathname) ?? null); setOpen(false); setScreen(null) }
    desktop.addEventListener("change", change)
    return () => desktop.removeEventListener("change", change)
  }, [pathname])

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

  const collapseControl = <button type="button" className="erp-sidebar-toggle" aria-label={collapsed ? "Expandir navegação" : "Recolher navegação"} aria-expanded={!collapsed} title={collapsed ? "Expandir navegação" : "Recolher navegação"} onClick={() => { closePanel(); setCollapsed(!collapsed) }}>{collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}</button>

  return <MenuContext.Provider value={{ open, show: element => { drawerTrigger.current = element; setScreen(null); setOpen(true) } }}>
    <a className="skip-link" href="#conteudo-principal">Pular para o conteúdo</a>
    <div className="erp-workspace" data-collapsed={collapsed} data-preferences={preferences}>
      <TooltipProvider delay={250}>
        <nav ref={navigation} className="erp-sidebar" aria-label="Módulos do ERP">
          <div className="erp-sidebar-heading"><Link href="/" className="erp-brand" aria-label="Visão geral do Avila ERP"><img className="erp-brand-mark" src="/brand/avila-erp-symbol.svg" alt="" width="32" height="32" /><span className="erp-brand-name"><strong>Avila ERP</strong><small>Avila Ops</small></span></Link>{collapseControl}</div>
          <div className="erp-sidebar-scroll">
            {homeLinks}
            <p className="erp-nav-caption">Módulos</p>
            <ul className="erp-module-list">{desktopMenus.map((menu, index) => {
              const Icon = icons[menu.label] || LayoutGrid
              return <li key={menu.label}><Tooltip><TooltipTrigger render={<CategoryButton className="erp-module-button" data-active={active === index} aria-label={menu.label} aria-expanded={selected === index} aria-controls={selected === index ? "erp-module-panel" : undefined} onClick={event => { trigger.current = event.currentTarget; setSelected(selected === index ? null : index) }} />}><Icon aria-hidden="true" /><span className="erp-module-copy"><span>{menu.label}</span>{active === index && activePage?.index === index && <small>{activePage.label}</small>}</span><ChevronRight className="erp-module-chevron" aria-hidden="true" /></TooltipTrigger>{collapsed && <TooltipContent side="right">{menu.label}{active === index && activePage?.index === index ? ` · ${activePage.label}` : ""}</TooltipContent>}</Tooltip>{!collapsed && selected === index && <div id="erp-module-panel" className="erp-inline-options"><Options index={index} pathname={pathname} onNavigate={() => {}} /></div>}</li>
            })}</ul>
            <div className="erp-index-entry"><button type="button" className="erp-module-button" data-active={active === menus.length - 1} aria-label="Índice completo" aria-expanded={selected === menus.length - 1} aria-controls={selected === menus.length - 1 ? "erp-module-panel" : undefined} onClick={event => { trigger.current = event.currentTarget; setSelected(selected === menus.length - 1 ? null : menus.length - 1) }}><LayoutGrid aria-hidden="true" /><span>Índice completo</span><ChevronRight className="erp-module-chevron" aria-hidden="true" /></button>{!collapsed && selected === menus.length - 1 && <div id="erp-module-panel" className="erp-inline-options"><Options index={selected} pathname={pathname} onNavigate={() => {}} /></div>}</div>
          </div>
          <div className="erp-sidebar-footer">{collapseControl}</div>
          {collapsed && selected !== null && <section ref={panel} tabIndex={-1} id="erp-module-panel" className="erp-module-panel" aria-labelledby="erp-module-title">
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
            const Icon = icons[menu.label] || LayoutGrid
            return <li key={menu.label}><CategoryButton ref={element => { moduleButtons.current[index] = element }} className="erp-module-button" data-active={active === index} type="button" aria-label={menu.label} onClick={() => { heading.current?.focus(); setScreen(index) }}><Icon aria-hidden="true" /><span className="erp-module-copy"><span>{menu.label}</span>{active === index && activePage?.index === index && <small>{activePage.label}</small>}</span><ChevronRight className="erp-module-chevron" aria-hidden="true" /></CategoryButton></li>
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
