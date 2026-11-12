"use client"
import { catalogPaletteFor } from "@/features/catalog/catalog-color-photo-model"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { erpFetch } from "@/lib/api/client"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/workspace/data-table"
import { X } from "lucide-react"
import { RequestError } from "@/components/feedback/session-recovery"
import { useCommand, useResource } from "@/hooks/use-operation"
import { GuardedLink as Link, useNavigationGuard } from "@/components/shell/navigation-guard"
import { states } from "@/features/commercial-settings/commercial-parameters"
import { Lookup, ColorChoice, PlateHolderChoice, type Choice } from "./orders"
import { NegotiationResult } from "./negotiation-result"
import { money, percent, inputAmount, parseAmount, type PriceTable, type SimulationInput, type Simulation } from "./negotiation-types"
import type { Opportunity } from "./opportunities"
import { commercialTableReturn, type CommercialSelection } from "./commercial-navigation-model"
import { CommercialCheckout, type CheckoutHandle } from "./commercial-checkout"
import type { CheckoutInput } from "./commercial-payment-model"

type Selected = { productId: string; quantity: string; structureColor: string; upholsteryColor: string; plateHolderColor: string; plateHolderType: string }
const selectClass = "h-9 min-h-9 min-w-0 rounded-lg border bg-background px-2"
const sectionHeadingClass = "scroll-mt-48 rounded-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring lg:scroll-mt-40"
function jumpTo(section: string) {
  const heading = document.getElementById(`simulator-${section}`)
  const disclosure = heading?.closest("details")
  if (disclosure) disclosure.open = true
  heading?.focus({ preventScroll: true })
  heading?.scrollIntoView({ block: "start" })
}

function pricingKey(input: { versionId: string; destinationState: string; taxpayer: boolean; discount: { kind: string; value: number }; freightCents: number; items: { productId: string; quantity: number }[] }) {
  return JSON.stringify([input.versionId, input.destinationState, input.taxpayer, input.discount.kind, input.discount.value, input.freightCents, input.items.map(item => [item.productId, item.quantity])])
}
type SimulatorProps = { initialLine: string; initialProduct: string; initialItems?: CommercialSelection[]; initialDestination?: string; initialTaxpayer?: boolean; initialOpportunity?: string; returnTo?: string }
export function CommercialSimulator(props: SimulatorProps) {
  return props.initialOpportunity ? <OpportunityContext {...props} id={props.initialOpportunity} /> : <SimulatorPage {...props} />
}
function OpportunityContext({ id, ...props }: SimulatorProps & { id: string }) {
  const source = useResource<{ tenantId: string; data: Opportunity }>(`/api/erp/opportunities/${id}`)
  if (source.loading) return <main className="p-6"><p role="status">Carregando dados da oportunidade…</p></main>
  if (source.error || !source.value) return <main className="p-6"><p role="alert"><RequestError message={source.error || "Oportunidade indisponível"} status={source.status} /></p></main>
  return <SimulatorPage {...props} opportunity={source.value.data} opportunityTenant={source.value.tenantId} />
}
function SimulatorPage({ initialLine, initialProduct, opportunity, opportunityTenant, returnTo, initialItems, initialDestination, initialTaxpayer }: SimulatorProps & { opportunity?: Opportunity; opportunityTenant?: string }) {
  const [line, setLine] = useState(initialLine === "national" ? "national" : "imported")
  const [lineLocked, setLineLocked] = useState(false)
  const context = new URLSearchParams()
  if (initialDestination) context.set("destinationState", initialDestination)
  if (initialTaxpayer) context.set("taxpayer", "true")
  const table = useResource<PriceTable>(`/api/erp/commercial/tables/${line}${context.size ? `?${context}` : ""}`)
  const access = useResource<{ tenant: { id: string }; permissions: string[] }>("/api/erp/me")
  const canCreate = table.value?.canCreateOrder !== false && access.value?.tenant.id === table.value?.tenantId && !!access.value?.permissions.includes("sales.orders.manage")
  return <main className="mx-auto min-w-0 max-w-7xl space-y-3 px-4 pb-8 pt-4 [&_label]:text-xs">
    <PageHeader breadcrumbs={[{ label: "Vendas", href: "/vendas" }, { label: "Simulador comercial" }]} title="Simulador comercial" description="Confira preços, entrada e condições antes de criar um pedido." />
    {opportunity && <section className="rounded-lg border p-4"><h2 className="font-semibold">{opportunity.title}</h2><p>{opportunity.customerName || opportunity.companyName} · {opportunity.contactName}</p><p className="whitespace-pre-wrap text-sm text-muted-foreground">{opportunity.notes}</p><Link className="text-primary underline" href={`/vendas/funil/${opportunity.id}`}>Abrir oportunidade de origem</Link></section>}
    <nav className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="Navegação comercial"><Link className="text-primary underline" href={commercialTableReturn(returnTo, line)}>Tabela de preços</Link><Link className="text-primary underline" href="/vendas/pedidos">Pedidos</Link>{table.value?.canManage && <><Link className="text-primary underline" href={`/preferencias/comercial?linha=${line}`}>Parâmetros e metas</Link><Link className="text-primary underline" href="/preferencias/aprovacao-comercial">Regras de aprovação</Link></>}</nav>
    <label className="grid max-w-64 gap-1">Linha comercial<select className={selectClass} disabled={lineLocked} value={line} onChange={e => { if (!document.querySelector("[data-simulation-dirty='true']") || window.confirm("Descartar a simulação desta linha?")) setLine(e.target.value) }}><option value="imported">Importada</option><option value="national">Nacional</option></select></label>
    {access.error && <p role="status" className="text-sm">Não foi possível conferir a permissão de criação. A simulação continua disponível. <Button variant="outline" onClick={access.reload}>Conferir acesso</Button></p>}
    {!access.loading && !access.error && !canCreate && <p className="text-sm text-muted-foreground">Seu acesso permite consultar e simular. Criar pedidos exige permissão de gestão de vendas.</p>}
    {table.loading ? <p role="status">Carregando versão publicada…</p> : table.error ? <div role="alert"><RequestError message={table.error} status={table.status} /><Button variant="outline" onClick={table.reload}>Tentar novamente</Button></div> : table.value && (opportunityTenant && opportunityTenant !== table.value.tenantId ? <p role="alert">A empresa da sessão mudou. Reabra a oportunidade.</p> : <Simulator key={`${line}:${table.value.tenantId}`} table={table.value} canCreate={canCreate} opportunity={opportunity} onLineLockChange={setLineLocked} initialItems={line === initialLine ? initialItems : undefined} initialDestination={initialDestination} initialTaxpayer={initialTaxpayer} initialProduct={line === initialLine ? initialProduct : ""} />)}
  </main>
}

function Simulator({ table: initialTable, initialProduct, initialItems, initialDestination, initialTaxpayer, opportunity, onLineLockChange, canCreate }: { table: PriceTable; initialProduct: string; initialItems?: CommercialSelection[]; initialDestination?: string; initialTaxpayer?: boolean; opportunity?: Opportunity; onLineLockChange: (locked: boolean) => void; canCreate: boolean }) {
  const router = useRouter()
  const command = useCommand()
  const [updatedTable, setUpdatedTable] = useState<PriceTable | null>(null)
  const [reloading, setReloading] = useState(false)
  const table = updatedTable || initialTable
  const [items, setItems] = useState<Selected[]>(() => (initialItems?.length ? initialItems : initialProduct ? [{ productId: initialProduct, quantity: 1 }] : []).map(item => ({ productId: item.productId, quantity: String(item.quantity), structureColor: "", upholsteryColor: "", plateHolderColor: "", plateHolderType: "" })))
  const [product, setProduct] = useState("")
  const [search, setSearch] = useState("")
  const [destination, setDestination] = useState(initialDestination || table.data?.originState || "")
  const [taxpayer, setTaxpayer] = useState(initialTaxpayer ? "true" : "false")
  const [discount, setDiscount] = useState<{ kind: "percent" | "amount" | "total"; raw: string }>({ kind: "percent", raw: "0" })
  const [freight, setFreight] = useState("")
  const [ourFreight, setOurFreight] = useState(false)
  const [downPayment, setDownPayment] = useState("")
  const [customer, setCustomer] = useState<Choice | null>(opportunity?.customerId ? { id: opportunity.customerId, legalName: opportunity.customerName || "Cliente da oportunidade" } : null)
  const [dueDate, setDueDate] = useState("")
  const [calculated, setResult] = useState<{ value: Simulation; input: SimulationInput } | null>(null)
  const [pricedTotal, setPricedTotal] = useState<{ key: string; totalCents: number; minimumCents: number } | null>(null)
  const checkout = useRef<CheckoutHandle>(null)
  const result = calculated?.input.versionId === table.data?.id ? calculated : null
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [everCalculated, setEverCalculated] = useState(false)
  const [error, setError] = useState("")
  const frozen = busy || reloading || command.busy || command.uncertain || command.stale
  const currentPriceKey = pricingKey({ versionId: table.data?.id || "", destinationState: destination, taxpayer: taxpayer === "true", discount: { kind: discount.kind, value: parseAmount(discount.raw) ?? -1 }, freightCents: ourFreight ? parseAmount(freight) ?? -1 : 0, items: items.map(item => ({ productId: item.productId, quantity: Number(item.quantity) })) })
  const paymentTotal = pricedTotal?.key === currentPriceKey ? pricedTotal.totalCents : null
  const paymentEntry = paymentTotal === null ? null : downPayment.trim() ? parseAmount(downPayment) : pricedTotal!.minimumCents
  const unavailableItems = items.filter(item => !table.data?.items.some(source => source.productId === item.productId && source.available !== false))
  useEffect(() => { onLineLockChange(frozen) }, [frozen, onLineLockChange])
  useNavigationGuard(dirty || command.uncertain ? "Sair sem concluir esta negociação?" : null)
  function change() { setResult(null); setDirty(true); setError(""); command.reset() }
  function simulationInput(): SimulationInput {
    if (!table.data) throw Error("Publique uma tabela antes de simular.")
    if (unavailableItems.length) throw Error("Há equipamentos indisponíveis nesta tabela. Confira a seleção e remova esses itens explicitamente para continuar.")
    const value = parseAmount(discount.raw)
    const freightCents = ourFreight ? parseAmount(freight) : 0
    const entry = downPayment.trim() ? parseAmount(downPayment) : null
    if (value === null || freightCents === null || (downPayment.trim() && entry === null) || !items.length || items.some(i => !/^\d{1,7}$/.test(i.quantity) || Number(i.quantity) < 1 || Number(i.quantity) > 1000000)) throw Error("Confira quantidade, desconto, frete e entrada. Use até duas casas decimais para valores.")
    return { line: table.line, versionId: table.data.id, destinationState: destination, taxpayer: taxpayer === "true", discount: { kind: discount.kind, value }, freightCents, downPaymentCents: entry, items: items.map(i => ({ productId: i.productId, quantity: Number(i.quantity), structureColor: i.structureColor || null, upholsteryColor: i.upholsteryColor || null, plateHolderColor: null, plateHolderType: i.plateHolderType || null })) }
  }
  async function simulate() {
    if (frozen) return
    let input: SimulationInput
    try { input = simulationInput() } catch (reason) { setError(reason instanceof Error ? reason.message : "Confira as condições."); jumpTo(!items.length || items.some(i => !/^\d{1,7}$/.test(i.quantity) || Number(i.quantity) < 1 || Number(i.quantity) > 1000000) ? "equipment" : "conditions"); return }
    setBusy(true); setError(""); setResult(null)
    try {
      const response = await erpFetch("/api/erp/commercial/simulate", { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": table.tenantId }, body: JSON.stringify(input) })
      const value: Simulation & { title?: string } = await response.json()
      if (!response.ok) throw Error(value.title || "Não foi possível simular.")
      if (value.tenantId !== table.tenantId || !/^[a-f0-9]{64}$/.test(value.digest) || !value.sale) throw Error("Resposta da simulação incompleta.")
      setPricedTotal({ key: pricingKey(input), totalCents: value.sale.totalCents, minimumCents: value.sale.minimumDownPaymentCents })
      setResult({ value, input }); setEverCalculated(true)
      const customerSection = document.getElementById("simulator-customer")?.closest("details")
      if (customerSection) customerSection.open = true
      requestAnimationFrame(() => {
        document.getElementById("simulator-result")?.focus({ preventScroll: true })
        if (window.matchMedia("(max-width: 1023px)").matches) jumpTo("result")
      })
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Simulação indisponível.") }
    finally { setBusy(false) }
  }
  async function convert() {
    if (!canCreate) return
    if (!result || !customer || !dueDate) { setError("Selecione o cliente e informe o vencimento antes de criar o pedido."); return }
    let terms: CheckoutInput | undefined
    if (table.paymentMethods !== undefined && !command.uncertain) {
      try { terms = checkout.current?.read(); if (!terms) throw Error("Confira as condições do pedido.") }
      catch (reason) { setError(reason instanceof Error ? reason.message : "Confira as condições do pedido."); jumpTo("customer"); return }
    }
    const value = await command.send<{ tenantId: string; id: string }>("/api/erp/commercial/orders", table.tenantId, { simulation: result.input, digest: result.value.digest, customerId: customer.id, dueDate, ...(terms ? { checkout: terms } : {}), ...(opportunity ? { opportunityId: opportunity.id, opportunityRevision: opportunity.revision } : {}) })
    if (value?.tenantId === table.tenantId && value.id) { setDirty(false); router.push(`/vendas/pedidos/${value.id}`) }
  }
  async function refreshTable() {
    if (reloading || command.busy || command.uncertain) return
    setReloading(true); setError("")
    try {
      const response = await erpFetch(`/api/erp/commercial/tables/${table.line}`, { cache: "no-store" })
      const latest: PriceTable & { title?: string } = await response.json()
      if (!response.ok) throw Error(latest.title || "Não foi possível atualizar a tabela.")
      if (latest.tenantId !== table.tenantId || latest.line !== table.line || !latest.data) throw Error("A tabela não está disponível para esta negociação. Confira a empresa e a publicação.")
      setUpdatedTable(latest); setResult(null); command.reset()
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível atualizar a tabela.") }
    finally { setReloading(false) }
  }
  if (!table.data) return <section className="form-section space-y-3"><p>Nenhuma tabela publicada nesta linha.</p>{table.canManage && <Link className="text-primary underline" href="/preferencias/tabela-precos">Publicar tabela de preços</Link>}</section>
  const choices = table.data.items.filter(i => i.available !== false && `${i.sku} ${i.name}`.toLowerCase().includes(search.toLowerCase()) && !items.some(selected => selected.productId === i.productId))
  return <div data-simulation-dirty={dirty} className="space-y-4">
    <div className="sticky top-[52px] z-20 space-y-1 border-y bg-background py-1 lg:top-16">
      <div className="flex min-w-0 items-center justify-between gap-2">
        {(error || command.error) ? <p role="alert" className="min-w-0 text-xs sm:text-sm"><RequestError message={error || command.error} status={command.status || undefined} /></p> : <p role="status" className="min-w-0 text-xs text-muted-foreground sm:text-sm">Tabela v{table.data.version} · {result ? "Calculada" : everCalculated ? "Alterada após o cálculo: simule novamente" : "Simulação não salva"}</p>}
        <div className="flex shrink-0 gap-2"><Button type="button" variant={result ? "outline" : "default"} disabled={frozen || !items.length} onClick={simulate}>{busy ? "Calculando…" : "Simular"}</Button>{result && canCreate && <Button type="button" disabled={frozen} onClick={() => jumpTo("customer")}>Continuar pedido</Button>}</div>
      </div>
      <nav aria-label="Etapas da simulação" className={`grid ${canCreate ? "grid-cols-4" : "grid-cols-3"} gap-1 text-xs sm:text-sm`}>
        {[["equipment", "Equipamentos"], ["conditions", "Condições"], ["result", "Resultado"], ...(canCreate ? [["customer", "Cliente"]] : [])].map(([id, label]) => <a key={id} href={`#simulator-${id}`} className="flex min-h-9 min-w-0 items-center justify-center rounded-md px-1 font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" onClick={event => { event.preventDefault(); jumpTo(id) }}>{label}</a>)}
      </nav>
    </div>
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] lg:gap-5">
      <div className="min-w-0 space-y-3"><fieldset disabled={frozen} className="form-section min-w-0 space-y-2 !p-3">
        <h2 id="simulator-equipment" tabIndex={-1} className={sectionHeadingClass}>Equipamentos</h2>
        {unavailableItems.length > 0 && <p role="alert" className="rounded-lg border p-2 text-xs">{unavailableItems.length} equipamento(s) da seleção não estão disponíveis nesta tabela. A seleção foi preservada. Remova os itens indisponíveis para continuar.</p>}
        <label className="grid min-w-0 gap-1 sm:gap-2">Buscar equipamento<Input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>
        <div className="flex min-w-0 flex-wrap gap-2"><select aria-label="Equipamento da tabela" className={`${selectClass} w-full flex-1`} value={product} onChange={e => setProduct(e.target.value)}><option value="">Selecione um equipamento</option>{choices.map(i => <option key={i.productId} value={i.productId}>{i.sku} · {i.name}</option>)}</select><Button type="button" variant="outline" disabled={!product || items.length >= 100} onClick={() => { if (items.some(i => i.productId === product)) return; setItems([...items, { productId: product, quantity: "1", structureColor: "", upholsteryColor: "", plateHolderColor: "", plateHolderType: "" }]); setProduct(""); change() }}>Adicionar</Button></div>
        {items.length ? <DataTable aria-label="Equipamentos da simulação" className="table-fixed"><thead><tr className="border-b text-xs text-muted-foreground"><th scope="col" className="py-2 font-medium">Equipamento</th><th scope="col" className="w-20 px-1 py-2 font-medium">Qtd.</th><th scope="col" className="w-11 py-2"><span className="sr-only">Ações</span></th></tr></thead><tbody>{items.map((item, index) => <SelectedProduct key={item.productId} item={item} name={table.data!.items.find(i => i.productId === item.productId)?.name || item.productId} sku={table.data!.items.find(i => i.productId === item.productId)?.sku || ""} tenant={table.tenantId} update={next => { setItems(items.map((i, n) => n === index ? next : i)); change() }} remove={() => { setItems(items.filter((_, n) => n !== index)); change() }} />)}</tbody></DataTable> : <p className="text-xs text-muted-foreground">Adicione equipamentos para iniciar.</p>}
        {!!items.length && <p className="text-xs text-muted-foreground">{items.length} equipamento{items.length !== 1 ? "s" : ""} · Cores e tipo de anilheiro em Acabamentos.</p>}
      </fieldset>
      <fieldset disabled={frozen} className="form-section min-w-0 space-y-2 !p-3">
        <h2 id="simulator-conditions" tabIndex={-1} className={sectionHeadingClass}>Condições comerciais</h2>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2 sm:grid-cols-2"><label className="grid min-w-0 gap-1 sm:gap-2">UF de destino<select className={selectClass} value={destination} onChange={e => { setDestination(e.target.value); change() }}>{states.map(uf => <option key={uf}>{uf}</option>)}</select></label><label className="grid min-w-0 gap-1 sm:gap-2">Inscrição estadual<select className={selectClass} value={taxpayer} onChange={e => { setTaxpayer(e.target.value); change() }}><option value="false">Não contribuinte</option><option value="true">Contribuinte</option></select></label></div>
        <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-2"><label className="grid min-w-0 gap-1 sm:gap-2">Preencher negociação por<select className={selectClass} value={discount.kind} onChange={e => { const kind = e.target.value as typeof discount.kind; const sale = result?.value.sale; setDiscount({ kind, raw: sale ? inputAmount(kind === "percent" ? sale.discountBps : kind === "amount" ? sale.discountCents : sale.totalCents) : kind === "total" ? "" : "0" }); change() }}><option value="percent">Desconto (%)</option><option value="amount">Desconto sem IPI (R$)</option><option value="total">Total com IPI (R$)</option></select></label>
        <label className="grid min-w-0 gap-1 sm:gap-2">{discount.kind === "percent" ? "Desconto (%)" : discount.kind === "amount" ? "Desconto em reais" : "Total que o cliente quer pagar"}<Input inputMode="decimal" value={discount.raw} onChange={e => { setDiscount({ ...discount, raw: e.target.value }); change() }} /></label></div>
        {discount.kind === "percent" && <input aria-label="Ajustar desconto percentual" type="range" min="0" max="99.99" step="0.01" className="w-full" value={(parseAmount(discount.raw) || 0) / 100} onChange={e => { setDiscount({ kind: "percent", raw: e.target.value }); change() }} />}
        <p className="text-sm">Livre até {percent(table.data.freeDiscountBps)}. Acima disso, exige aprovação.</p>
        {result && <p className="text-sm">Desconto calculado: {percent(result.value.sale.discountBps)} · {money(result.value.sale.discountCents)} sem IPI. Total: {money(result.value.sale.totalCents)}.</p>}
        <label className="flex items-center gap-2"><input type="checkbox" checked={ourFreight} onChange={e => { setOurFreight(e.target.checked); change() }} />Frete por nossa conta</label>
        {ourFreight && <label className="grid min-w-0 gap-1 sm:gap-2">Frete pago pela empresa (R$)<Input inputMode="decimal" value={freight} onChange={e => { setFreight(e.target.value); change() }} /></label>}
        {(table.paymentMethods === undefined || !canCreate) && <><label className="grid min-w-0 gap-1 sm:gap-2"><span>Entrada negociada (R$)<span className="sr-only">, deixe vazia para usar a política</span></span><Input aria-describedby="simulator-entry-help" inputMode="decimal" value={downPayment} onChange={e => { setDownPayment(e.target.value); change() }} /></label><p id="simulator-entry-help" className="text-xs text-muted-foreground">Deixe a entrada vazia para usar a política comercial.</p></>}
      </fieldset>
      </div>
      <aside className="min-w-0 space-y-3 lg:sticky lg:top-48 lg:row-span-2 lg:max-h-[calc(100dvh-13rem)] lg:overflow-y-auto lg:overscroll-contain" aria-labelledby="simulator-result">
        <h2 id="simulator-result" tabIndex={-1} className={sectionHeadingClass}>Resultado</h2>
        {result ? <NegotiationResult sale={result.value.sale} director={result.value.director} /> : <p className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">{items.length ? "Confira as condições e clique em Simular." : "Adicione equipamentos para calcular preços e entrada."}{everCalculated && " Simule novamente para atualizar os valores."}</p>}
        {command.stale && <div className="space-y-2 rounded-lg border bg-background p-3 text-sm"><p>A tabela ou a política mudou. Atualize e confira os valores antes de criar o pedido.</p><Button variant="outline" className="h-auto min-h-10 whitespace-normal" disabled={reloading} onClick={refreshTable}>{reloading ? "Atualizando tabela…" : "Atualizar tabela e simular novamente"}</Button></div>}
      </aside>
      {canCreate && <details className="form-section min-w-0 space-y-3 !p-3 lg:col-start-1">
        <summary className="cursor-pointer"><h2 id="simulator-customer" tabIndex={-1} className={sectionHeadingClass}>Dados para criar o pedido</h2></summary>
        <Lookup compact endpoint="parties" label="cliente" searchOnly selectedName={customer?.legalName} disabled={frozen} choose={value => { setCustomer(value); setDirty(true) }} />
        {table.paymentMethods !== undefined ? <CommercialCheckout ref={checkout} tenantId={table.tenantId} customerId={customer?.id} methods={table.paymentMethods} totalCents={paymentTotal} entryCents={paymentEntry} entryRaw={downPayment} onEntryChange={raw => { setDownPayment(raw); change() }} dueDate={dueDate} onDueDateChange={date => { setDueDate(date); setDirty(true) }} onDirty={() => setDirty(true)} disabled={frozen} /> : <label className="grid min-w-0 gap-1 sm:gap-2">Vencimento da conta a receber<Input type="date" disabled={frozen} value={dueDate} onChange={e => { setDueDate(e.target.value); setDirty(true) }} /></label>}
        {result && <>
          {(!customer || !dueDate) && <p className="text-xs text-muted-foreground">Selecione o cliente e informe o vencimento para criar o pedido.</p>}
          <Button className="h-auto min-h-11 max-w-full whitespace-normal" disabled={!customer || !dueDate || busy || reloading || command.busy || command.stale} onClick={convert}>{command.uncertain ? "Conferir criação com o mesmo comando" : "Criar pedido com estas condições"}</Button>
          <p className="text-xs text-muted-foreground">{table.paymentMethods !== undefined ? "O pedido recebe um número. A confirmação seguinte reserva o estoque e gera os títulos da entrada e das parcelas, sem registrar recebimentos." : "O pedido recebe um número. A confirmação seguinte reserva o estoque."}</p>
        </>}
      </details>}
    </div>
  </div>
}

function SelectedProduct({ item, name, sku, tenant, update, remove }: { item: Selected; name: string; sku: string; tenant: string; update: (next: Selected) => void; remove: () => void }) {
  const product = useResource<{ tenantId: string; data: { structureColors?: string[]; upholsteryColors?: string[]; upholsteryConfigurable?: boolean; plateHolderColors?: string[]; plateHolderTypes?: string[] } }>(`/api/erp/products/${item.productId}`)
  const colors = product.value?.tenantId === tenant ? product.value.data : null
  const palette = catalogPaletteFor(colors?.structureColors)
  const selectedFinishes = [item.structureColor, item.upholsteryColor, item.plateHolderType].filter(Boolean).join(" · ")
  return <>
    <tr>
      <th scope="row" className="min-w-0 break-words py-3 pr-2 text-left align-top font-medium"><span className="block text-xs text-muted-foreground">{sku}</span>{name}</th>
      <td className="px-1 py-3 align-top"><Input aria-label={`Quantidade de ${name}`} className="px-2 text-center tabular-nums" inputMode="numeric" value={item.quantity} onChange={e => update({ ...item, quantity: e.target.value })} /></td>
      <td className="py-3 align-top"><Button variant="ghost" size="icon" type="button" aria-label={`Remover equipamento ${name}`} onClick={remove}><X aria-hidden="true" /></Button></td>
    </tr>
    <tr className="border-b last:border-0"><td colSpan={3} className="min-w-0 pb-3">
      {product.error && <div className="space-y-2 rounded-lg border p-2 text-xs"><p role="alert"><RequestError message={product.error} status={product.status} /></p><Button type="button" variant="outline" disabled={product.loading} aria-label={`Recarregar acabamentos de ${name}`} onClick={product.reload}>{product.loading ? "Carregando acabamentos…" : "Recarregar acabamentos"}</Button></div>}
      <details className="group min-w-0">
        <summary className="min-h-10 cursor-pointer rounded-md py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">Acabamentos<span className="sr-only"> de {name}</span><span className="ml-2 text-xs font-normal text-muted-foreground group-open:hidden">{selectedFinishes || "Escolher cores"}</span></summary>
        <div className="grid min-w-0 gap-4 pt-3 sm:grid-cols-2">
          <FinishChoice title="Estrutura" label={`Cor da estrutura de ${name}`} options={colors?.structureColors} value={item.structureColor} onChange={value => update({ ...item, structureColor: value })} />

          <PlateHolderChoice label={`Tipo de anilheiro de ${name}`} value={item.plateHolderType} onChange={value => update({ ...item, plateHolderType: value })} />
          {colors?.upholsteryConfigurable !== false && <FinishChoice title={palette ? "Braços" : "Estofado"} palette={palette} label={`${palette ? "Cor dos braços" : "Cor do estofado"} de ${name}`} options={colors?.upholsteryColors} value={item.upholsteryColor} onChange={value => update({ ...item, upholsteryColor: value })} />}
        </div>
      </details>
    </td></tr>
  </>
}

function FinishChoice({ title, ...props }: Parameters<typeof ColorChoice>[0] & { title: string }) {
  return <div className="min-w-0 space-y-2 [&_label]:sr-only"><p className="text-sm font-medium">{title}</p><ColorChoice {...props} /></div>
}
