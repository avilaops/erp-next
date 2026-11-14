"use client"
import { Pagination } from "@/components/workspace/pagination"
import { EntityListPage, SearchToolbar, FilterField, StatusBadge, EmptyState, ResponsiveTable, CurrencyCell, SortableTableHeader } from "@/components/workspace/list-layout"
import { useTableSort } from "@/components/workspace/use-table-sort"
import { DataTable } from "@/components/workspace/data-table"

import { erpFetch } from "@/lib/api/client"

import type { Schema } from "@/lib/api/types"

import { decimalPattern } from "@/lib/decimal-input"

import { RequestError } from "@/components/feedback/session-recovery"

import { GuardedLink as Link } from "@/components/shell/navigation-guard"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useId, useRef, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Button, buttonVariants } from "@/components/ui/button"
import { SearchInput } from "@/components/search-input"
import { Input } from "@/components/ui/input"
import { ProductThumbnail } from "@/features/catalog/product-thumbnail"
import { CatalogColorPhotos, CatalogPaletteReference } from "@/features/catalog/catalog-color-photos"
import { catalogPaletteFor, type CatalogPalette } from "@/features/catalog/catalog-color-photo-model"
import type { CatalogFinishPart } from "@/features/catalog/catalog-finish-palettes"
import { quantity, useCommand, useResource } from "../../hooks/use-operation"
import { CommercialReturn } from "../returns/commercial-return"
import { OrderCommissionTerms } from "@/features/finance/commissions-workspace"
import { OrderSalesRules } from "./settings/sales-settings"
import { OrderNegotiation } from "./order-negotiation"
import { commercialMoney, orderNumber } from "./order-presentation"
import { OrderPricing } from "@/features/commercial-settings/order-pricing"
import { OrderDetailCommercial } from "./order-detail-commercial"
import { OrderEmail } from "./order-email"
import type { CheckoutSnapshot } from "./commercial-payment-model"
import { OrderWeightSummary } from "./order-weight-summary"
import { listNavigationHref } from "@/lib/list-navigation"

type Detail = Schema<"OrderSnapshot"> & { pricingOrigin?: boolean; checkout?: CheckoutSnapshot | null }
type Listing = Schema<"OrderList">
export type Choice = { id: string; legalName?: string; name?: string; sku?: string; basePrice?: string; unit?: string; structureColors?: string[]; swingArmColors?: string[]; finishingPalette?: string | null; upholsteryColors?: string[]; upholsteryConfigurable?: boolean; plateHolderColors?: string[]; plateHolderTypes?: string[]; hasPhoto?: boolean }
type SelectedItem = Choice & { quantity: string; preserved: boolean; structureColor: string; swingArmColor: string; upholsteryColor: string; plateHolderColor: string; plateHolderType: string }
const labels: Record<string, string> = { draft: "Rascunho", confirmed: "Reservado", completed: "Concluído", cancelled: "Cancelado" }
const linkClass = "font-medium text-primary underline underline-offset-4"

export function PlateHolderChoice({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId()
  return <div className="grid min-w-0 gap-1 text-sm"><label htmlFor={id}>{label}</label><select id={id} className="h-9 min-h-9 w-full min-w-0 rounded-lg border border-input bg-background px-2" value={value === "Não se aplica" ? "" : value} onChange={event => onChange(event.target.value)}>
    <option value="">Não se aplica</option><option value="Standard">Standard</option><option value="Olímpico">Olímpico</option>
    {value && !["Não se aplica", "Standard", "Olímpico"].includes(value) && <option value={value}>{value} · registrado</option>}
  </select></div>
}

export function ColorChoice({ label, options = [], value, onChange, catalog, palette, part = "structure", optional = false }: { label: string; part?: CatalogFinishPart; optional?: boolean; palette?: CatalogPalette; options?: string[]; value: string; onChange: (value: string) => void; catalog?: { productId: string; tenantId: string; field: "structureColors" | "swingArmColors" | "upholsteryColors" | "plateHolderColors" | "plateHolderTypes" } }) {
  const id = useId()
  const [refreshed, setRefreshed] = useState<string[] | null>(null)
  const [refreshedPalette, setRefreshedPalette] = useState<CatalogPalette | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const choices = refreshed ?? options
  async function refresh() {
    if (!catalog || loading) return
    setLoading(true); setError("")
    try {
      const response = await erpFetch(`/api/erp/products/${catalog.productId}`, { cache: "no-store" })
      const product = await response.json()
      if (!response.ok || product.tenantId !== catalog.tenantId) throw new Error("Não foi possível atualizar as opções deste produto.")
      const colors = product.data[catalog.field] || []
      setRefreshed(colors); setRefreshedPalette(catalogPaletteFor(product.data.finishingPalette))
      if (!colors.length) setError("Ainda não há opções cadastradas. Salve o acabamento no produto e atualize novamente.")
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao consultar opções.") }
    finally { setLoading(false) }
  }
  if (!choices.length && !value) return null
  return <div className="grid min-w-0 gap-2 text-sm">
    <label htmlFor={id}>{label}</label>
    <select id={id} className="min-h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3" value={value} required={choices.length > 0 && !optional} disabled={loading || !choices.length && !value} onChange={event => onChange(event.target.value)}>
      <option value="">{optional ? "Manter sem seleção" : choices.length ? (catalog?.field === "plateHolderTypes" ? "Escolha um tipo" : "Escolha uma cor") : "Sem opções cadastradas"}</option>
      {value && !choices.includes(value) && <option value={value}>{value} · seleção registrada</option>}
      {choices.map(color => <option key={color} value={color}>{color}</option>)}
    </select>
    <CatalogColorPhotos label={label} options={choices} value={value} onChange={onChange} disabled={loading} palette={refreshed === null ? palette : refreshedPalette} part={part} showSource={false} />
    {catalog && !choices.length && <div className="flex flex-wrap items-center gap-3">
      <Link className={linkClass} href={`/cadastros/produtos/${catalog.productId}/editar#product-colors`} target="_blank" rel="noopener noreferrer" aria-label={`Cadastrar opções de ${label} (nova aba)`}>Cadastrar opções</Link>
      <Button type="button" variant="outline" disabled={loading} aria-label={`Atualizar opções de ${label}`} onClick={() => void refresh()}>{loading ? "Atualizando…" : "Atualizar opções"}</Button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </div>
}

export function Lookup({ endpoint, label, disabled, choose, searchOnly = false, selectedName, compact = false, placeholder, hideLabel = false }: { endpoint: string; label: string; disabled: boolean; choose: (value: Choice) => void; searchOnly?: boolean; selectedName?: string; compact?: boolean; placeholder?: string; hideLabel?: boolean }) {
  const [query, setQuery] = useState({ q: "", offset: 0 })
  const [showResults, setShowResults] = useState(!searchOnly)
  const section = useRef<HTMLElement>(null)
  const resultsId = useId()
  useEffect(() => {
    if (!searchOnly) return
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !section.current?.contains(event.target)) setShowResults(false)
    }
    document.addEventListener("pointerdown", dismiss)
    return () => document.removeEventListener("pointerdown", dismiss)
  }, [searchOnly])
  const search = query.q.trim() === "%%" ? "" : query.q
  const params = new URLSearchParams({ q: search, offset: String(query.offset), limit: "10", status: "active" })
  if (endpoint === "parties") params.set("role", "customer")
  const result = useResource<{ data: Choice[]; total: number; tenantId: string }>(`/api/erp/${endpoint}?${params}`)
  function submitSearch() {
    const input = section.current?.querySelector("input")
    input?.focus()
    setQuery({ q: input?.value || "", offset: 0 })
    setShowResults(true)
    result.reload()
  }
  return <section ref={section} className={searchOnly ? "relative min-w-0 self-start" : "min-w-0 space-y-2 rounded-xl border p-2 sm:space-y-3 sm:p-4"} aria-label={`Seleção de ${label}`}
    onBlur={event => { if (searchOnly && !event.currentTarget.contains(event.relatedTarget)) setShowResults(false) }}
    onKeyDown={event => { if (searchOnly && event.key === "Escape") { setShowResults(false); section.current?.querySelector("input")?.focus() } }}>
    <div className="flex flex-wrap items-end gap-2" role="search" onKeyDown={event => {
      if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return
      event.preventDefault()
      submitSearch()
    }}>
      <label className={`min-w-0 flex-1 ${compact ? "space-y-1" : "space-y-2"}`}><span className={hideLabel ? "sr-only" : undefined}>Buscar {label}</span><SearchInput placeholder={placeholder} className={compact ? "h-9 min-h-9" : undefined} aria-expanded={searchOnly ? showResults : undefined} aria-controls={searchOnly && showResults ? resultsId : undefined} onSearch={q => { setQuery({ q, offset: 0 }); if (!searchOnly || section.current?.contains(document.activeElement)) setShowResults(true) }} onChange={() => { if (searchOnly) setShowResults(false) }} name="q" maxLength={160} disabled={disabled} /></label><Button type="button" className={compact ? "h-9 min-h-9 px-3" : undefined} aria-label={`Pesquisar ${label}`} onClick={submitSearch} disabled={disabled || result.loading}>{compact ? "Buscar" : `Pesquisar ${label}`}</Button>
    </div>
    {selectedName && <p role="status" className="mt-3 break-words text-sm font-medium text-primary">Cliente selecionado: {selectedName}</p>}
    {showResults && <div id={resultsId} aria-label={`Resultados de ${label}`} className={searchOnly ? "absolute inset-x-0 top-full z-40 mt-2 max-h-[min(20rem,40dvh)] space-y-3 overflow-y-auto overscroll-contain rounded-xl border bg-popover p-3 text-popover-foreground shadow-xl" : "space-y-3"}>{result.loading ? <p role="status">Consultando {label}…</p> : result.error ? <p role="alert"><RequestError message={result.error} status={result.status} /></p> : <>
      <ul className="space-y-2">{result.value?.data.map(value => <li className="min-w-0" key={value.id}><Button className="h-auto min-h-11 w-full max-w-full justify-start gap-3 break-words whitespace-normal text-left" variant="outline" aria-label={`Selecionar ${value.legalName || value.name}${value.sku ? ` · ${value.sku}` : ""}`} disabled={disabled} onClick={() => { choose(value); if (searchOnly) setShowResults(false) }}>{endpoint === "products" && <ProductThumbnail id={value.id} name={value.name || value.sku || "Produto"} tenantId={result.value!.tenantId} hasPhoto={value.hasPhoto} decorative />}<span className="min-w-0">{value.legalName || value.name}{value.sku ? ` · ${value.sku}` : ""}</span></Button></li>)}</ul>
      {!result.value?.data.length && <p>Nenhum resultado encontrado.</p>}
      <div className="flex flex-wrap justify-between gap-2"><Button variant="outline" disabled={disabled || !query.offset} onClick={() => setQuery({ ...query, offset: Math.max(0, query.offset - 10) })}>Anterior {label}</Button><Button variant="outline" disabled={disabled || query.offset + 10 >= (result.value?.total || 0)} onClick={() => setQuery({ ...query, offset: query.offset + 10 })}>Próximo {label}</Button></div>
      <Link className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4" href={endpoint === "parties" ? "/cadastros/clientes-fornecedores/novo" : "/cadastros/produtos/novo"} target="_blank" rel="noopener noreferrer">Cadastrar {endpoint === "parties" ? "cliente" : "produto"}</Link>
    </>}</div>}
  </section>
}

export function Orders({ id, create = false, edit = false }: { id?: string; create?: boolean; edit?: boolean }) {
  if (create || edit) return <OrderEditor id={edit ? id : undefined} />
  if (id) return <OrderDetail key={id} id={id} />
  return <OrderList />
}

function OrderList() {
  const router = useRouter()
  const url = useSearchParams()
  const offsetValue = Number(url.get("offset") || 0)
  const offset = Number.isSafeInteger(offsetValue) && offsetValue >= 0 && offsetValue <= 100000 ? Math.floor(offsetValue / 25) * 25 : 0
  const { sort, toggle, query: sortQuery } = useTableSort(["number", "customerName", "status", "dueDate", "amount"], { by: "", order: "asc" })
  function navigate(patch: Record<string, string | number>) {
    const next = new URLSearchParams(window.location.search)
    for (const [key, value] of Object.entries(patch)) { if (String(value)) next.set(key, String(value)); else next.delete(key) }
    router.push(`${window.location.pathname}?${next}${window.location.hash}`, { scroll: false })
  }
  const q = (url.get("q") || "").slice(0, 160)
  const params = new URLSearchParams({ offset: String(offset), limit: "25" })
  if (q) params.set("q", q)
  for (const [key, value] of sortQuery) params.set(key, value)
  const result = useResource<Listing>(`/api/erp/orders?${params}`)
  const createAction = result.value?.canEdit && <Link className={buttonVariants()} href="/vendas/pedidos/novo">Novo pedido</Link>
  return <EntityListPage title="Pedidos de venda" actions={<><Link className={buttonVariants({ variant: "outline" })} href="/vendas/tabela-precos">Tabela de preços</Link>{result.value?.canEdit && <Link className={buttonVariants({ variant: "outline" })} href="/vendas/pedidos/novo?modo=catalogo">Pedido pelo catálogo</Link>}{createAction}</>} toolbar={
    <SearchToolbar pending={result.loading} canClear={Boolean(q)} onClear={() => navigate({ q: "", offset: 0 })} onSubmit={event => { event.preventDefault(); const nextQ = String(new FormData(event.currentTarget).get("q") || "").trim(); if (nextQ === q && !offset) result.reload(); else navigate({ q: nextQ, offset: 0 }) }}>
      <FilterField label="Buscar pedidos"><SearchInput name="q" maxLength={160} defaultValue={q} onSearch={q => navigate({ q: q.trim(), offset: 0 })} placeholder="Número, cliente ou CPF/CNPJ" /></FilterField>
    </SearchToolbar>
  } summary={!result.loading && !result.error && (<p role="status" className="text-sm text-muted-foreground">{result.value?.total || 0} pedido(s){q && " encontrado(s)"}</p>)} footer={!result.loading && !result.error && (<Pagination offset={offset} pageSize={25} total={result.value?.total || 0} maxOffset={100000} onOffsetChange={offset => navigate({ offset })} />)}>
      {result.loading ? <p role="status">Carregando pedidos…</p> : result.error ? <div role="alert"><p><RequestError message={result.error} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button></div> : <>
        <ResponsiveTable label="Lista de pedidos">
          <DataTable className="min-w-[52rem] text-left text-sm">
            <caption className="sr-only">Pedidos de venda</caption>
            <thead className="bg-muted/50"><tr><SortableTableHeader field="number" sort={sort} onSort={toggle} className="p-3">Pedido</SortableTableHeader><SortableTableHeader field="customerName" sort={sort} onSort={toggle} className="w-[60%] p-2 sm:w-auto sm:p-3">Cliente</SortableTableHeader><SortableTableHeader field="status" sort={sort} onSort={toggle} className="p-3">Situação</SortableTableHeader><SortableTableHeader field="dueDate" sort={sort} onSort={toggle} className="p-3">Vencimento</SortableTableHeader><SortableTableHeader field="amount" sort={sort} onSort={toggle} className="w-[40%] p-2 text-right sm:w-auto sm:p-3">Valor</SortableTableHeader></tr></thead>
            <tbody>{result.value?.data.map(order => <tr className="border-t hover:bg-muted/30" key={order.id}>
              <td className="whitespace-nowrap p-3"><Link className={linkClass} href={`/vendas/pedidos/${order.id}`}>{orderNumber(order.number)}</Link></td>
              <td className="min-w-0 p-2 align-top sm:p-3"><Link className={`${linkClass} line-clamp-2 break-words [overflow-wrap:anywhere] sm:line-clamp-none`} title={order.customerName} href={`/vendas/pedidos/${order.id}`}>{order.customerName}</Link><span className="hidden text-xs text-muted-foreground sm:block">{order.customerTaxId}</span></td>
              <td className="whitespace-nowrap p-3"><StatusBadge tone={order.status === "completed" ? "success" : order.status === "cancelled" ? "neutral" : "info"}>{labels[order.status] || order.status}</StatusBadge></td>
              <td className="whitespace-nowrap p-3">{order.dueDate ? order.dueDate.split("-").reverse().join("/") : "Não informado"}</td>
              <CurrencyCell className="p-3 align-top">{commercialMoney(order.amount)}</CurrencyCell>
            </tr>)}{!result.value?.data.length && <tr><td colSpan={5}><EmptyState filtered={Boolean(q)} action={result.value?.canEdit && <Link href="/vendas/pedidos/novo">Criar pedido</Link>} /></td></tr>}</tbody>
          </DataTable>
        </ResponsiveTable>
      </>}
  </EntityListPage>
}

function OrderEditor({ id }: { id?: string }) {
  const access = useResource<Listing | Detail>(id ? `/api/erp/orders/${id}` : "/api/erp/orders?limit=1")
  if (access.loading) return <><PageHeader breadcrumbs={[{ label: "Vendas", href: "/vendas" }, { label: "Pedidos", href: "/vendas/pedidos" }, { label: id ? "Editar" : "Novo" }]} title={id ? "Editar pedido de venda" : "Novo pedido de venda"} description="Selecione o cliente e adicione os produtos do pedido." /><p role="status">Carregando rascunho e permissões…</p></>
  if (access.error || !access.value) return <><PageHeader breadcrumbs={[{ label: "Vendas", href: "/vendas" }, { label: "Pedidos", href: "/vendas/pedidos" }, { label: id ? "Editar" : "Novo" }]} title={id ? "Editar pedido de venda" : "Novo pedido de venda"} description="Selecione o cliente e adicione os produtos do pedido." /><Link className={linkClass} href="/vendas/pedidos">Voltar à lista</Link><section className="form-section space-y-3"><p role="alert"><RequestError message={access.error || "Pedido indisponível"} status={access.status} /></p><Button onClick={access.reload}>Tentar novamente</Button></section></>
  const initial = "items" in access.value ? access.value : undefined
  if (initial?.pricingOrigin) return <><PageHeader eyebrow="Vendas" title="Condições preservadas" description="Este pedido mantém os itens e preços da simulação publicada." /><Link className={linkClass} href={`/vendas/pedidos/${initial.data.id}`}>Consultar pedido e condições</Link></>
  if (!access.value.canEdit || (initial && initial.data.status !== "draft")) {
    return <><PageHeader eyebrow="Vendas" title="Edição do pedido" description="Alterações são permitidas somente em rascunhos com autorização de gestão." /><section className="form-section space-y-3"><p role="status">{!access.value.canEdit ? "Somente consulta. Solicite permissão para alterar pedidos." : "Este pedido não está em rascunho e não pode ser editado."}</p><Link className={linkClass} href={id ? `/vendas/pedidos/${id}` : "/vendas/pedidos"}>Voltar aos pedidos</Link></section></>
  }
  return <OrderForm key={`${id || "new"}:${access.etag}`} initial={initial} etag={access.etag} tenantId={access.value.tenantId} reload={access.reload} />
}

function OrderForm({ initial, etag, tenantId, reload }: { initial?: Detail; etag: string; tenantId: string; reload: () => void }) {
  const router = useRouter()
  const command = useCommand()
  const originalCustomer: Choice | null = initial ? { id: initial.data.customerId, legalName: initial.data.customerName } : null
  const [customer, setCustomer] = useState<Choice | null>(originalCustomer)
  const [items, setItems] = useState<SelectedItem[]>(() => initial?.items.map(item => ({ id: item.productId, name: item.name, sku: item.sku, unit: item.unit, basePrice: item.unitPrice, quantity: item.quantity, preserved: true, structureColor: item.structureColor || "", swingArmColor: item.swingArmColor || "", upholsteryColor: item.upholsteryColor || "", plateHolderColor: item.plateHolderColor || "", plateHolderType: item.plateHolderType || "" })) || [])
  const [dueDate, setDueDate] = useState(initial?.data.dueDate || "")
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState("")
  const frozen = command.busy || command.uncertain || command.stale
  useEffect(() => {
    if (!initial) return
    const controller = new AbortController()
    void Promise.all(initial.items.map(async item => {
      const response = await erpFetch(`/api/erp/products/${item.productId}`, { cache: "no-store", signal: controller.signal })
      const value = await response.json()
      if (!response.ok || value.tenantId !== tenantId) throw new Error("Não foi possível consultar as opções de cores. As escolhas registradas foram mantidas; recarregue para alterar o acabamento.")
      return { id: item.productId, structureColors: value.data.structureColors || [], swingArmColors: value.data.swingArmColors || [], finishingPalette: value.data.finishingPalette, upholsteryConfigurable: value.data.upholsteryConfigurable, upholsteryColors: value.data.upholsteryColors || [], plateHolderColors: value.data.plateHolderColors || [], plateHolderTypes: value.data.plateHolderTypes || [], hasPhoto: value.data.hasPhoto }
    })).then(products => {
      if (!controller.signal.aborted) setItems(previous => previous.map(item => ({ ...item, ...products.find(product => product.id === item.id) })))
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Falha ao consultar cores") })
    return () => controller.abort()
  }, [initial, tenantId])
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty || command.uncertain) event.preventDefault() }
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent)
  }, [dirty, command.uncertain])
  return <><PageHeader breadcrumbs={[{ label: "Vendas", href: "/vendas" }, { label: "Pedidos", href: "/vendas/pedidos" }, ...(initial ? [{ label: orderNumber(initial.data.number), href: `/vendas/pedidos/${initial.data.id}` }] : []), { label: initial ? "Editar" : "Novo" }]} title={initial ? "Editar pedido" : "Novo pedido"} description="Selecione o cliente, adicione os produtos e informe o vencimento." />
    <section className="form-section min-w-0 space-y-3 sm:space-y-5">
        <Link className={linkClass} href={initial ? `/vendas/pedidos/${initial.data.id}` : "/vendas/pedidos"} onClick={event => { if ((dirty || command.uncertain) && !window.confirm("Sair sem confirmar as alterações deste rascunho?")) event.preventDefault() }}>Voltar aos pedidos</Link>
        <div className="grid min-w-0 gap-2 sm:gap-4 lg:grid-cols-2"><Lookup compact endpoint="parties" label="cliente" searchOnly selectedName={customer?.legalName} disabled={frozen} choose={value => { setCustomer(value.id === originalCustomer?.id ? originalCustomer : value); setDirty(true) }} /><Lookup compact endpoint="products" label="produto" searchOnly disabled={frozen} choose={value => {
          const existing = items.find(item => item.id === value.id)
          if (existing) {
            const normalized = quantity(existing.quantity)
            if (!normalized) { setError("Informe uma quantidade válida para acrescentar uma unidade."); return }
            const [whole, fraction] = normalized.split(".")
            if (whole === "999999999999") { setError("A quantidade máxima deste item foi atingida."); return }
            const nextQuantity = `${Number(whole) + 1}.${fraction}`.replace(/\.?0+$/, "")
            setItems(previous => previous.map(item => item.id === value.id ? { ...item, quantity: nextQuantity } : item))
            setDirty(true); setError(""); return
          }
          if (items.length >= 100) { setError("O pedido aceita até 100 produtos diferentes."); return }
          const saved = initial?.items.find(item => item.productId === value.id)
          const choice = saved ? { id: saved.productId, name: saved.name, sku: saved.sku, unit: saved.unit, basePrice: saved.unitPrice } : value
          setItems(previous => [...previous, { ...value, ...choice, quantity: "1", preserved: Boolean(saved), structureColor: saved?.structureColor || "", swingArmColor: saved?.swingArmColor || "", upholsteryColor: saved?.upholsteryColor || "", plateHolderColor: saved?.plateHolderColor || "", plateHolderType: saved?.plateHolderType || "" }]); setDirty(true); setError("")
        }} /></div>
        <details className="border-y py-2"><summary className="cursor-pointer text-sm font-medium">Regras para confirmar o pedido</summary><div className="pt-2"><OrderSalesRules tenantId={tenantId} /></div></details>
        <form className="space-y-2 sm:space-y-4" onSubmit={async event => {
          event.preventDefault(); setError("")
          if (!customer || !items.length || items.some(item => !quantity(item.quantity))) { setError("Selecione cliente e itens com quantidades decimais válidas."); return }
          const value = await command.send<Detail>(initial ? `/api/erp/orders/${initial.data.id}` : "/api/erp/orders", tenantId, { customerId: customer.id, dueDate, items: items.map(item => ({ productId: item.id, quantity: quantity(item.quantity), structureColor: item.structureColor, swingArmColor: item.swingArmColor || null, upholsteryColor: item.upholsteryColor, plateHolderColor: null, plateHolderType: item.plateHolderType || null })) }, initial ? etag : "", initial ? "PUT" : "POST")
          if (value) { setDirty(false); router.replace(listNavigationHref(`/vendas/pedidos/${value.data.id}`, window.location.pathname, window.location.search.slice(1))) }
        }}>
          <fieldset disabled={frozen} className="min-w-0 space-y-2 sm:space-y-4">
            <label className="block min-w-0 space-y-2">Vencimento da conta a receber<Input type="date" required value={dueDate} onChange={event => { setDueDate(event.target.value); setDirty(true) }} /></label>
            {items.map(item => <div key={item.id} role="group" aria-label={`Item do pedido: ${item.name}`} className="min-w-0 space-y-2 border-b py-3 sm:space-y-3 sm:py-4"><div className="flex min-w-0 items-center gap-3"><ProductThumbnail id={item.id} name={item.name || item.sku || "Produto"} tenantId={tenantId} hasPhoto={item.hasPhoto} decorative /><strong className="min-w-0 break-words">{item.name}</strong></div><p className="break-all text-sm">SKU {item.sku} · {item.preserved ? "Preço registrado" : "Preço base consultado"}: {item.basePrice ? commercialMoney(item.basePrice) : "Não informado"}</p><label className="block min-w-0 space-y-2">Quantidade de {item.name}<Input required inputMode="decimal" pattern={decimalPattern(6)} maxLength={19} value={item.quantity} onChange={event => { setItems(previous => previous.map(value => value.id === item.id ? { ...value, quantity: event.target.value } : value)); setDirty(true) }} /></label>
              <details className="min-w-0" onInvalidCapture={event => { event.currentTarget.open = true }}>
                <summary className="cursor-pointer py-1 text-sm font-medium">Acabamentos<span className="ml-2 text-xs font-normal text-muted-foreground">{[item.structureColor, item.swingArmColor, item.upholsteryColor, item.plateHolderType].filter(Boolean).join(" · ") || "Escolher opções"}</span></summary>
                <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
                  <ColorChoice part="structure" palette={catalogPaletteFor(item.finishingPalette)} label={`Cor da estrutura de ${item.name}`} catalog={{ productId: item.id, tenantId, field: "structureColors" }} options={item.structureColors} value={item.structureColor} onChange={color => { setItems(previous => previous.map(value => value.id === item.id ? { ...value, structureColor: color } : value)); setDirty(true) }} />
                  <ColorChoice part="swingArm" optional={Boolean(initial?.items.some(line => line.productId === item.id && !line.swingArmColor))} palette={catalogPaletteFor(item.finishingPalette)} label={`Cor dos braços de ${item.name}`} catalog={{ productId: item.id, tenantId, field: "swingArmColors" }} options={item.swingArmColors} value={item.swingArmColor} onChange={color => { setItems(previous => previous.map(value => value.id === item.id ? { ...value, swingArmColor: color } : value)); setDirty(true) }} />
                  {(item.upholsteryConfigurable !== false || item.upholsteryColor) && <ColorChoice part="upholstery" palette={catalogPaletteFor(item.finishingPalette)} label={`Cor do estofado de ${item.name}`} catalog={{ productId: item.id, tenantId, field: "upholsteryColors" }} options={item.upholsteryConfigurable === false ? [] : item.upholsteryColors} value={item.upholsteryColor} onChange={color => { setItems(previous => previous.map(value => value.id === item.id ? { ...value, upholsteryColor: color } : value)); setDirty(true) }} />}
                  <PlateHolderChoice label={`Tipo de anilheiro de ${item.name}`} value={item.plateHolderType} onChange={plateHolderType => { setItems(previous => previous.map(value => value.id === item.id ? { ...value, plateHolderType } : value)); setDirty(true) }} />
                </div>
                <CatalogPaletteReference palette={catalogPaletteFor(item.finishingPalette)} />
              <p className="text-xs text-muted-foreground">O acabamento fica registrado neste item. O saldo de estoque continua controlado por produto.</p></details>
              <Button type="button" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal break-words text-left" onClick={() => { setItems(previous => previous.filter(value => value.id !== item.id)); setDirty(true) }}>Remover {item.name}</Button></div>)}
          </fieldset>
          <OrderWeightSummary tenantId={tenantId} items={items.map(item => ({ productId: item.id, quantity: item.quantity }))} />
          {(error || command.error) && <p role="alert"><RequestError message={error || command.error} status={error ? undefined : command.status} /></p>}
          {command.uncertain && <p role="status">Confirmação pendente. A repetição usa o mesmo comando.</p>}
          {command.stale && <Button type="button" variant="outline" onClick={() => { if (!dirty || window.confirm("Recarregar e descartar as alterações locais deste rascunho?")) { command.reset(); reload() } }}>Recarregar rascunho</Button>}
          {!initial && <p className="text-xs text-muted-foreground">Ao criar, o pedido recebe um número. Depois, confirme para reservar estoque.</p>}
          <Button type="submit" disabled={command.busy || command.stale || !customer || !items.length}>{command.busy ? initial ? "Salvando…" : "Criando…" : command.uncertain ? initial ? "Conferir alteração do pedido" : "Conferir criação do pedido" : initial ? "Salvar rascunho" : "Criar pedido"}</Button>
        </form>
    </section>
  </>
}

function OrderDetail({ id }: { id: string }) {
  const result = useResource<Detail>(`/api/erp/orders/${id}`)
  const access = useResource<{ tenant: { id: string }; permissions: string[] }>("/api/erp/me")
  const command = useCommand()
  const [notice, setNotice] = useState("")
  const [pendingAction, setPendingAction] = useState("")
  const value = result.value
  async function act(action: string) {
    if (!value || !result.etag) return
    setPendingAction(action); setNotice("")
    const response = await command.send<Detail>(`/api/erp/orders/${id}/${action}`, value.tenantId, {}, result.etag)
    if (response) { setNotice("Operação confirmada no servidor."); result.reload() }
  }
  return <><PageHeader breadcrumbs={[{ label: "Vendas", href: "/vendas" }, { label: "Pedidos", href: "/vendas/pedidos" }, { label: value ? orderNumber(value.data.number) : "Detalhe" }]} title={value ? orderNumber(value.data.number) : "Pedido de venda"} />
    <section className="min-w-0 space-y-4" aria-label="Detalhes do pedido">
      {notice && <p role="status">{notice}</p>}
      {result.loading ? <p role="status">Carregando pedido…</p> : result.error ? <p role="alert"><RequestError message={result.error} status={result.status} /></p> : value && <>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-4 border-b pb-4">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-3"><span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{labels[value.data.status]}</span></div><p className="mt-1 break-words">{value.data.customerName}</p></div>
          <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm"><div><dt className="text-xs text-muted-foreground">Total do pedido</dt><dd className="font-semibold tabular-nums">{commercialMoney(value.data.amount)}</dd></div><div><dt className="text-xs text-muted-foreground">Vencimento</dt><dd className="tabular-nums">{value.data.dueDate.split("-").reverse().join("/")}</dd></div></dl>
        </div>
        {["completed", "cancelled"].includes(value.data.status) && <p className="rounded-lg border bg-muted/35 px-3 py-2 text-sm">Pedido {value.data.status === "completed" ? "concluído" : "cancelado"}: os dados comerciais estão disponíveis para consulta.</p>}
        <div className="space-y-2 print:hidden" role="group" aria-label="Documentos do pedido">
          <p className="text-xs font-medium text-muted-foreground">Documentos</p>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap [&>button]:w-full sm:[&>button]:w-auto">
          <Button variant="outline" className="h-9 px-3" onClick={() => window.print()}>Salvar PDF</Button>
          <OrderEmail id={id} number={value.data.number} tenantId={value.tenantId} etag={result.etag} onReload={result.reload} />
          <Link className={buttonVariants({ variant: "outline", className: "col-span-2 h-9 px-3" })} href={`/vendas/pedidos/${id}/contratos`}>Pedido e contratos</Link>
          </div>
        </div>
        {["confirmed", "completed"].includes(value.data.status) && ["fiscal.nfe.read", "fiscal.nfe.manage", "catalog.parties.read", "catalog.products.read"].every(permission => access.value?.permissions.includes(permission)) && <Link className={buttonVariants({ variant: "outline", className: "h-9 px-3" })} href={`/fiscal/notas-saida/nova?pedido=${id}`}>Preparar NF-e deste pedido</Link>}
        {!value.canEdit && <p>Somente consulta.</p>}
        {command.error && <p role="alert"><RequestError message={command.error} status={command.status} /></p>}
        {command.stale && <Button variant="outline" onClick={() => { command.reset(); result.reload() }}>Recarregar pedido</Button>}
        {command.uncertain ? <Button disabled={command.busy} onClick={() => act(pendingAction)}>Repetir confirmação do pedido</Button> : value.canEdit && ["draft", "confirmed"].includes(value.data.status) && <div className="space-y-2 border-y py-3 print:hidden"><p className="text-xs font-medium text-muted-foreground">Ações do pedido</p><div className="flex flex-wrap gap-2 [&>button:first-child]:basis-full sm:[&>button:first-child]:basis-auto">
          {value.data.status === "draft" && <Button className="h-auto min-h-11 max-w-full whitespace-normal px-3" disabled={command.busy || command.stale || !result.etag} onClick={() => act("confirm")}>{value.checkout ? "Confirmar, reservar e gerar parcelas" : "Confirmar e reservar estoque"}</Button>}
          {value.data.status === "confirmed" && <Button className="h-auto max-w-full whitespace-normal" disabled={command.busy || command.stale || !result.etag} onClick={() => { if (window.confirm(value.checkout ? "Registrar a saída de estoque e concluir este pedido? Os títulos da entrada e das parcelas já foram gerados na confirmação. Recebimentos são registrados no financeiro." : "Registrar saída de estoque e gerar a conta a receber deste pedido?")) void act("complete") }}>{value.checkout ? "Concluir pedido" : "Concluir e gerar conta a receber"}</Button>}
          {value.data.status === "draft" && !value.pricingOrigin && !command.busy && !command.stale && <Link className={buttonVariants({ variant: "outline", className: "h-9 flex-1 px-3 sm:flex-none" })} href={`/vendas/pedidos/${id}/editar`}>Editar rascunho</Link>}
          <Button variant="outline" className="h-9 flex-1 px-3 sm:flex-none" disabled={command.busy || command.stale || !result.etag} onClick={() => { if (window.confirm("Cancelar o pedido e liberar sua reserva, se houver?")) void act("cancel") }}>Cancelar pedido</Button>
        </div></div>}
        <OrderDetailCommercial order={value} permissions={access.value?.tenant.id === value.tenantId ? access.value.permissions : []} />
        <div className="divide-y border-y">
          <details className="py-3"><summary className="cursor-pointer text-sm font-medium">Negociação e condições comerciais</summary><div className="space-y-4 pt-3"><OrderNegotiation id={id} onDecision={result.reload} showDirector={access.value?.tenant.id === value.tenantId && ["sales.approvals.director", "platform.company.manage"].every(permission => access.value?.permissions.includes(permission))} />{value.data.status === "draft" && <OrderSalesRules tenantId={value.tenantId} />}{value.pricingOrigin && <OrderPricing id={id} onSaved={result.reload} showDirector={access.value?.tenant.id === value.tenantId && ["sales.approvals.director", "platform.company.manage"].every(permission => access.value?.permissions.includes(permission))} />}</div></details>
          {access.value?.permissions.includes("finance.commissions.read") && <details className="py-3"><summary className="cursor-pointer text-sm font-medium">Comissões do pedido</summary><div className="pt-3"><OrderCommissionTerms orderId={id} onSaved={result.reload} /></div></details>}
        </div>
        {(value.data.status === "completed" || value.checkout && value.data.status === "confirmed") && <Link className={linkClass} href="/financeiro/contas-receber">Consultar contas a receber</Link>}
        {["completed", "cancelled"].includes(value.data.status) && <CommercialReturn kind="sale" id={id} tenantId={value.tenantId} etag={result.etag} reversed={value.data.status === "cancelled"} canManage={value.canEdit && access.value?.tenant.id === value.tenantId && ["inventory.stock.manage", "finance.receivables.manage"].every(permission => access.value!.permissions.includes(permission))} disabled={command.busy || command.uncertain || command.stale} onSuccess={() => { setNotice("Cancelamento integral confirmado. Consulte o histórico e acompanhe a situação fiscal da NF-e."); result.reload() }} onReload={result.reload} />}
      </>}
    </section>
  </>
}

