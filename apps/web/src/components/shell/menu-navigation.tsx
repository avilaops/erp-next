"use client"

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { BarChart3, Boxes, BriefcaseBusiness, ChevronsUpDown, ChevronRight, History, House, LayoutGrid, Menu, PanelLeftClose, PanelLeftOpen, ShoppingCart, Truck, Users, Wallet, Search, X, PackageCheck, ReceiptText, Settings2, Wrench, type LucideIcon } from "lucide-react"
import { GuardedLink as Link } from "./navigation-guard"
import { CategoryButton } from "./category-button"
import { desktopMenus, moduleLinks, navigationDestinations } from "./navigation-catalog"
import { isDemonstrationRoute } from "@/lib/demonstration-routes"
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
const mobileGroups = [
  { label: "Operações", modules: ["Vendas", "Compras", "Estoque", "Logística", "Serviços"] },
  { label: "Gestão", modules: ["Meu Negócio", "Financeiro", "Fiscal", "Relatórios", "Cadastros", "Preferências"] },
]
const searchableDestinations = navigationDestinations.filter(item => !isDemonstrationRoute(item.href.split("?")[0]))
function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim()
}

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
        <Link href={item.href} onNavigate={onNavigate} className="erp-option" aria-current={item.href === active ? "page" : undefined}><span className="min-w-0">{item.label}{isDemonstrationRoute(item.href.split("?")[0]) && <small className="block text-xs text-muted-foreground">Indisponível</small>}</span></Link>
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
  const [search, setSearch] = useState("")
  const [recent, setRecent] = useState<string[]>([])
  const [previousPath, setPreviousPath] = useState(pathname)
  const navigation = useRef<HTMLElement>(null)
  const panel = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const drawerTrigger = useRef<HTMLElement | null>(null)
  const active = currentArea(pathname)
  const activePage = currentPage(pathname)

  if (previousPath !== pathname) {
    setPreviousPath(pathname)
    if (previousPath !== "/" && searchableDestinations.some(item => item.href === previousPath)) {
      setRecent([previousPath, ...recent.filter(href => href !== previousPath)].slice(0, 5))
    }
    setSelected(preferences ? null : currentArea(pathname) ?? null)
    setOpen(false)
    setScreen(null)
  }

  function closePanel(restoreFocus = false) {
    setSelected(null)
    if (restoreFocus) trigger.current?.focus()
  }

  useEffect(() => {
    if (selected === null || open) return
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
  }, [selected, collapsed, open])

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 900px)")
    const change = () => { setSelected(currentArea(pathname) ?? null); setOpen(false); setScreen(null) }
    desktop.addEventListener("change", change)
    return () => desktop.removeEventListener("change", change)
  }, [pathname])

  const terms = normalizeSearch(search).split(/\s+/).filter(Boolean)
  const results = terms.length ? searchableDestinations.filter(item => {
    const keywords = normalizeSearch(item.keywords)
    return terms.every(term => keywords.includes(term))
  }).slice(0, 12) : []
  const recentDestinations = recent.flatMap(href => searchableDestinations.filter(item => item.href === href))

  const homeLinks = <ul className="erp-home-links">
    {([{ label: "Visão geral", href: "/", Icon: House }, { label: "Histórico importado", href: "/historico", Icon: History }]).map(({ label, href, Icon }) => {
      return <li key={href}><Link href={href} className="erp-module-button" title={label} aria-label={label} aria-current={matches(pathname, href) ? "page" : undefined} onNavigate={() => { closePanel(); setOpen(false) }}><Icon aria-hidden="true" /><span>{label}</span></Link></li>
    })}
  </ul>

  const collapseControl = <button type="button" className="erp-sidebar-toggle" aria-label={collapsed ? "Expandir navegação" : "Recolher navegação"} aria-expanded={!collapsed} title={collapsed ? "Expandir navegação" : "Recolher navegação"} onClick={() => { closePanel(); setCollapsed(!collapsed) }}>{collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}</button>

  return <MenuContext.Provider value={{ open, show: element => { drawerTrigger.current = element; setSearch(""); setScreen(null); setOpen(true) } }}>
    <a className="skip-link" href="#conteudo-principal">Pular para o conteúdo</a>
    <div className="erp-workspace" data-collapsed={collapsed} data-preferences={preferences}>
      <TooltipProvider delay={250}>
        <nav ref={navigation} className="erp-sidebar" aria-label="Módulos do ERP">
          <div className="erp-sidebar-heading"><Link href="/" className="erp-brand" aria-label="Visão geral do ERP"><img className="erp-brand-mark" src="/brand/avila-erp-symbol.svg" alt="" width="32" height="32" /><span className="erp-brand-name"><strong>ERP</strong><small>Avila Ops</small></span></Link>{collapseControl}</div>
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
          <SheetTitle className="sr-only">Menu do ERP</SheetTitle>
          <Link href="/empresas" className="erp-drawer-account" onNavigate={() => setOpen(false)} aria-label="ERP • Trocar empresa">
            <img src="/brand/avila-erp-symbol.svg" alt="" width="28" height="28" />
            <span>ERP<small>Trocar empresa</small></span>
            <ChevronsUpDown aria-hidden="true" />
          </Link>
          <SheetClose className="erp-menu-icon" aria-label="Fechar menu"><X aria-hidden="true" /></SheetClose>
        </div>
        <div className="erp-drawer-search">
          <Search aria-hidden="true" />
          <input type="search" aria-label="Pesquisar no menu" placeholder="Pesquisa rápida…" value={search} onChange={event => setSearch(event.target.value)} />
        </div>
        <nav className="erp-drawer-scroll" aria-label="Módulos e fluxos do ERP">
          {terms.length ? <div aria-label="Resultados do menu">
            <p className="erp-nav-caption" role="status">{results.length ? `${results.length} resultado(s)` : "Nenhuma página encontrada"}</p>
            <ul>{results.map(item => <li key={item.href}><Link className="erp-option" href={item.href} onNavigate={() => setOpen(false)}><span>{item.label}<small>{item.category}</small></span></Link></li>)}</ul>
          </div> : <>
            {homeLinks}
            {recentDestinations.length > 0 && <details className="erp-drawer-recent">
              <summary className="erp-module-button"><History aria-hidden="true" /><span>Recentes</span><ChevronRight className="erp-module-chevron" aria-hidden="true" /></summary>
              <ul>{recentDestinations.map(item => <li key={item.href}><Link className="erp-option" href={item.href} onNavigate={() => setOpen(false)}><span>{item.label}<small>{item.category}</small></span></Link></li>)}</ul>
            </details>}
            {mobileGroups.map(group => <section key={group.label} className="erp-drawer-group">
              <h3 className="erp-nav-caption">{group.label}</h3>
              <ul className="erp-drawer-modules">{desktopMenus.map((menu, index) => {
                if (!group.modules.includes(menu.label)) return null
                const Icon = icons[menu.label] || LayoutGrid
                return <li key={menu.label}>
                  <CategoryButton className="erp-module-button" data-active={active === index} type="button" aria-label={menu.label} aria-expanded={screen === index} aria-controls={`erp-drawer-module-${index}`} onClick={() => setScreen(screen === index ? null : index)}><Icon aria-hidden="true" /><span>{menu.label}</span><ChevronRight className="erp-module-chevron" aria-hidden="true" /></CategoryButton>
                  <div id={`erp-drawer-module-${index}`} className="erp-drawer-branch" hidden={screen !== index}>{screen === index && <Options index={index} pathname={pathname} onNavigate={() => setOpen(false)} />}</div>
                </li>
              })}</ul>
            </section>)}
            <div className="erp-index-entry">
              <button className="erp-module-button" type="button" aria-expanded={screen === menus.length - 1} aria-controls="erp-drawer-index" onClick={() => setScreen(screen === menus.length - 1 ? null : menus.length - 1)}><LayoutGrid aria-hidden="true" /><span>Índice completo</span><ChevronRight className="erp-module-chevron" aria-hidden="true" /></button>
              <div id="erp-drawer-index" className="erp-drawer-branch" hidden={screen !== menus.length - 1}>{screen === menus.length - 1 && <Options index={screen} pathname={pathname} onNavigate={() => setOpen(false)} />}</div>
            </div>
          </>}
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
