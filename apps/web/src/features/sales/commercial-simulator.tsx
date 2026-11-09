"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { erpFetch } from "@/lib/api/client"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RequestError } from "@/components/feedback/session-recovery"
import { useCommand, useResource } from "@/hooks/use-operation"
import { useNavigationGuard } from "@/components/shell/navigation-guard"
import { states } from "@/features/commercial-settings/commercial-parameters"
import { Lookup, ColorChoice, type Choice } from "./orders"
import { NegotiationResult } from "./negotiation-result"
import { money, percent, inputAmount, parseAmount, type PriceTable, type SimulationInput, type Simulation } from "./negotiation-types"
import type { Opportunity } from "./opportunities"

type Selected = { productId: string; quantity: string; structureColor: string; upholsteryColor: string; plateHolderColor: string; plateHolderType: string }
const selectClass = "min-h-10 min-w-0 rounded-lg border bg-background px-2"

type SimulatorProps = { initialLine: string; initialProduct: string; initialOpportunity?: string }
export function CommercialSimulator(props: SimulatorProps) {
  return props.initialOpportunity ? <OpportunityContext {...props} id={props.initialOpportunity} /> : <SimulatorPage {...props} />
}
function OpportunityContext({ id, ...props }: SimulatorProps & { id: string }) {
  const source = useResource<{ tenantId: string; data: Opportunity }>(`/api/erp/opportunities/${id}`)
  if (source.loading) return <main className="p-6"><p role="status">Carregando dados da oportunidade…</p></main>
  if (source.error || !source.value) return <main className="p-6"><p role="alert"><RequestError message={source.error || "Oportunidade indisponível"} status={source.status} /></p></main>
  return <SimulatorPage {...props} opportunity={source.value.data} opportunityTenant={source.value.tenantId} />
}
function SimulatorPage({ initialLine, initialProduct, opportunity, opportunityTenant }: SimulatorProps & { opportunity?: Opportunity; opportunityTenant?: string }) {
  const [line, setLine] = useState(initialLine === "national" ? "national" : "imported")
  const [lineLocked, setLineLocked] = useState(false)
  const table = useResource<PriceTable>(`/api/erp/commercial/tables/${line}`)
  return <main className="mx-auto min-w-0 max-w-7xl space-y-3 px-4 pb-8 sm:space-y-5 sm:pb-24 pt-6">
    <PageHeader eyebrow="Vendas" title="Simulador comercial" description="Confira preços, entrada e condições antes de criar um pedido." />
    {opportunity && <section className="rounded-lg border p-4"><h2 className="font-semibold">{opportunity.title}</h2><p>{opportunity.customerName || opportunity.companyName} · {opportunity.contactName}</p><p className="whitespace-pre-wrap text-sm text-muted-foreground">{opportunity.notes}</p><Link className="text-primary underline" href={`/vendas/funil/${opportunity.id}`}>Abrir oportunidade de origem</Link></section>}
    <nav className="flex flex-wrap gap-4"><Link className="text-primary underline" href="/vendas/tabela-precos">Tabela de preços</Link>{table.value?.canManage && <><Link className="text-primary underline" href="/preferencias/comercial">Parâmetros e metas</Link><Link className="text-primary underline" href="/preferencias/aprovacao-comercial">Regras de aprovação</Link></>}</nav>
    <label className="grid max-w-sm gap-2">Linha comercial<select className={selectClass} disabled={lineLocked} value={line} onChange={e => { if (!document.querySelector("[data-simulation-dirty='true']") || window.confirm("Descartar a simulação desta linha?")) setLine(e.target.value) }}><option value="imported">Importada</option><option value="national">Nacional</option></select></label>
    {table.loading ? <p role="status">Carregando versão publicada…</p> : table.error ? <p role="alert"><RequestError message={table.error} status={table.status} /></p> : table.value && (opportunityTenant && opportunityTenant !== table.value.tenantId ? <p role="alert">A empresa da sessão mudou. Reabra a oportunidade.</p> : <Simulator key={`${line}:${table.value.tenantId}:${table.value.data?.id}`} table={table.value} opportunity={opportunity} onLineLockChange={setLineLocked} initialProduct={line === initialLine ? initialProduct : ""} />)}
  </main>
}

function Simulator({ table, initialProduct, opportunity, onLineLockChange }: { table: PriceTable; initialProduct: string; opportunity?: Opportunity; onLineLockChange: (locked: boolean) => void }) {
  const router = useRouter()
  const command = useCommand()
  const [items, setItems] = useState<Selected[]>(() => table.data?.items.some(i => i.productId === initialProduct) ? [{ productId: initialProduct, quantity: "1", structureColor: "", upholsteryColor: "", plateHolderColor: "", plateHolderType: "" }] : [])
  const [product, setProduct] = useState("")
  const [search, setSearch] = useState("")
  const [destination, setDestination] = useState(table.data?.originState || "")
  const [taxpayer, setTaxpayer] = useState("false")
  const [discount, setDiscount] = useState<{ kind: "percent" | "amount" | "total"; raw: string }>({ kind: "percent", raw: "0" })
  const [freight, setFreight] = useState("")
  const [ourFreight, setOurFreight] = useState(false)
  const [downPayment, setDownPayment] = useState("")
  const [customer, setCustomer] = useState<Choice | null>(opportunity?.customerId ? { id: opportunity.customerId, legalName: opportunity.customerName || "Cliente da oportunidade" } : null)
  const [dueDate, setDueDate] = useState("")
  const [result, setResult] = useState<{ value: Simulation; input: SimulationInput } | null>(null)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [everCalculated, setEverCalculated] = useState(false)
  const [error, setError] = useState("")
  const frozen = busy || command.busy || command.uncertain || command.stale
  useEffect(() => { onLineLockChange(frozen) }, [frozen, onLineLockChange])
  useNavigationGuard(dirty || command.uncertain ? "Sair sem concluir esta negociação?" : null)
  function change() { setResult(null); setDirty(true); setError(""); command.reset() }
  function simulationInput(): SimulationInput {
    if (!table.data) throw Error("Publique uma tabela antes de simular.")
    const value = parseAmount(discount.raw)
    const freightCents = ourFreight ? parseAmount(freight) : 0
    const entry = downPayment.trim() ? parseAmount(downPayment) : null
    if (value === null || freightCents === null || (downPayment.trim() && entry === null) || !items.length || items.some(i => !/^\d{1,7}$/.test(i.quantity) || Number(i.quantity) < 1 || Number(i.quantity) > 1000000)) throw Error("Confira quantidade, desconto, frete e entrada. Use até duas casas decimais para valores.")
    return { line: table.line, versionId: table.data.id, destinationState: destination, taxpayer: taxpayer === "true", discount: { kind: discount.kind, value }, freightCents, downPaymentCents: entry, items: items.map(i => ({ productId: i.productId, quantity: Number(i.quantity), structureColor: i.structureColor || null, upholsteryColor: i.upholsteryColor || null, plateHolderColor: i.plateHolderColor || null, plateHolderType: i.plateHolderType || null })) }
  }
  async function simulate() {
    if (frozen) return
    let input: SimulationInput
    try { input = simulationInput() } catch (reason) { setError(reason instanceof Error ? reason.message : "Confira as condições."); return }
    setBusy(true); setError(""); setResult(null)
    try {
      const response = await erpFetch("/api/erp/commercial/simulate", { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": table.tenantId }, body: JSON.stringify(input) })
      const value: Simulation & { title?: string } = await response.json()
      if (!response.ok) throw Error(value.title || "Não foi possível simular.")
      if (value.tenantId !== table.tenantId || !/^[a-f0-9]{64}$/.test(value.digest) || !value.sale) throw Error("Resposta da simulação incompleta.")
      setResult({ value, input }); setEverCalculated(true)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Simulação indisponível.") }
    finally { setBusy(false) }
  }
  async function convert() {
    if (!result || !customer || !dueDate) { setError("Selecione o cliente e informe o vencimento antes de criar o pedido."); return }
    const value = await command.send<{ tenantId: string; id: string }>("/api/erp/commercial/orders", table.tenantId, { simulation: result.input, digest: result.value.digest, customerId: customer.id, dueDate, ...(opportunity ? { opportunityId: opportunity.id, opportunityRevision: opportunity.revision } : {}) })
    if (value?.tenantId === table.tenantId && value.id) { setDirty(false); router.push(`/vendas/pedidos/${value.id}`) }
  }
  if (!table.data) return <section className="form-section space-y-3"><p>Nenhuma tabela publicada nesta linha.</p>{table.canManage && <Link className="text-primary underline" href="/preferencias/tabela-precos">Publicar tabela de preços</Link>}</section>
  const choices = table.data.items.filter(i => `${i.sku} ${i.name}`.toLowerCase().includes(search.toLowerCase()) && !items.some(selected => selected.productId === i.productId))
  return <div data-simulation-dirty={dirty} className="space-y-4">
    <p role="status">Tabela v{table.data.version} · {result ? "Calculada" : everCalculated ? "Alterada após o cálculo: simule novamente" : "Simulação não salva"}</p>
    <div className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
      <div className="min-w-0 space-y-3 sm:space-y-5"><fieldset disabled={frozen} className="form-section min-w-0 space-y-2 sm:space-y-4"><legend className="px-2 font-semibold">Equipamentos e condições</legend>
        <label className="grid min-w-0 gap-1 sm:gap-2">Buscar equipamento<Input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>
        <div className="flex min-w-0 flex-wrap gap-2"><select aria-label="Equipamento da tabela" className={`${selectClass} w-full flex-1`} value={product} onChange={e => setProduct(e.target.value)}><option value="">Selecione um equipamento</option>{choices.map(i => <option key={i.productId} value={i.productId}>{i.sku} · {i.name}</option>)}</select><Button type="button" variant="outline" disabled={!product || items.length >= 100} onClick={() => { if (items.some(i => i.productId === product)) return; setItems([...items, { productId: product, quantity: "1", structureColor: "", upholsteryColor: "", plateHolderColor: "", plateHolderType: "" }]); setProduct(""); change() }}>Adicionar</Button></div>
        {items.map((item, index) => <SelectedProduct key={item.productId} item={item} name={table.data!.items.find(i => i.productId === item.productId)?.name || item.productId} tenant={table.tenantId} update={next => { setItems(items.map((i, n) => n === index ? next : i)); change() }} remove={() => { setItems(items.filter((_, n) => n !== index)); change() }} />)}
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2 sm:grid-cols-2 sm:gap-4"><label className="grid min-w-0 gap-1 sm:gap-2">UF de destino<select className={selectClass} value={destination} onChange={e => { setDestination(e.target.value); change() }}>{states.map(uf => <option key={uf}>{uf}</option>)}</select></label><label className="grid min-w-0 gap-1 sm:gap-2">Inscrição estadual<select className={selectClass} value={taxpayer} onChange={e => { setTaxpayer(e.target.value); change() }}><option value="false">Cliente sem IE / não contribuinte</option><option value="true">Cliente contribuinte com IE</option></select></label></div>
        <label className="grid min-w-0 gap-1 sm:gap-2">Preencher negociação por<select className={selectClass} value={discount.kind} onChange={e => { const kind = e.target.value as typeof discount.kind; const sale = result?.value.sale; setDiscount({ kind, raw: sale ? inputAmount(kind === "percent" ? sale.discountBps : kind === "amount" ? sale.discountCents : sale.totalCents) : kind === "total" ? "" : "0" }); change() }}><option value="percent">Desconto em percentual (%)</option><option value="amount">Desconto em reais, sem IPI (R$)</option><option value="total">Cliente quer pagar: total com IPI (R$)</option></select></label>
        <label className="grid min-w-0 gap-1 sm:gap-2">{discount.kind === "percent" ? "Desconto (%)" : discount.kind === "amount" ? "Desconto em reais" : "Total que o cliente quer pagar"}<Input inputMode="decimal" value={discount.raw} onChange={e => { setDiscount({ ...discount, raw: e.target.value }); change() }} /></label>
        {discount.kind === "percent" && <input aria-label="Ajustar desconto percentual" type="range" min="0" max="99.99" step="0.01" className="w-full" value={(parseAmount(discount.raw) || 0) / 100} onChange={e => { setDiscount({ kind: "percent", raw: e.target.value }); change() }} />}
        <p className="text-sm">Livre até {percent(table.data.freeDiscountBps)}. Acima disso, exige aprovação.</p>
        {result && <p className="text-sm">Desconto calculado: {percent(result.value.sale.discountBps)} · {money(result.value.sale.discountCents)} sem IPI. Total: {money(result.value.sale.totalCents)}.</p>}
        <label className="flex items-center gap-2"><input type="checkbox" checked={ourFreight} onChange={e => { setOurFreight(e.target.checked); change() }} />Frete por nossa conta</label>
        {ourFreight && <label className="grid min-w-0 gap-1 sm:gap-2">Frete pago pela empresa (R$)<Input inputMode="decimal" value={freight} onChange={e => { setFreight(e.target.value); change() }} /></label>}
        <label className="grid min-w-0 gap-1 sm:gap-2">Entrada negociada (R$), deixe vazia para usar a política<Input inputMode="decimal" value={downPayment} onChange={e => { setDownPayment(e.target.value); change() }} /></label>
        <Button type="button" disabled={!items.length} onClick={simulate}>{busy ? "Calculando…" : "Simular"}</Button>
      </fieldset>
      <section className="form-section space-y-2 sm:space-y-4"><h2 className="font-semibold">Dados para criar o pedido</h2><Lookup endpoint="parties" label="cliente" searchOnly selectedName={customer?.legalName} disabled={frozen} choose={value => { setCustomer(value); setDirty(true) }} /><label className="grid min-w-0 gap-1 sm:gap-2">Vencimento da conta a receber<Input type="date" disabled={frozen} value={dueDate} onChange={e => { setDueDate(e.target.value); setDirty(true) }} /></label>{result && <Button disabled={!customer || !dueDate || busy || command.busy || command.stale} onClick={convert}>{command.uncertain ? "Conferir criação com o mesmo comando" : "Criar pedido com estas condições"}</Button>}</section>
      </div>
      <div className="min-w-0 space-y-4">{result ? <NegotiationResult sale={result.value.sale} director={result.value.director} /> : <section className="form-section"><p>Preencha as condições e simule para conferir o resultado.</p></section>}{(error || command.error) && <p role="alert"><RequestError message={error || command.error} status={command.status || undefined} /></p>}{command.stale && <p>A tabela ou a política mudou. Recarregue a página e simule novamente.</p>}</div>
    </div>
  </div>
}

function SelectedProduct({ item, name, tenant, update, remove }: { item: Selected; name: string; tenant: string; update: (next: Selected) => void; remove: () => void }) {
  const product = useResource<{ tenantId: string; data: { structureColors?: string[]; upholsteryColors?: string[]; upholsteryConfigurable?: boolean; plateHolderColors?: string[]; plateHolderTypes?: string[] } }>(`/api/erp/products/${item.productId}`)
  const colors = product.value?.tenantId === tenant ? product.value.data : null
  return <div className="min-w-0 space-y-3 rounded-lg border p-3"><h3 className="break-words font-medium">{name}</h3><label className="grid min-w-0 gap-1 sm:gap-2">Quantidade de {name}<Input inputMode="numeric" value={item.quantity} onChange={e => update({ ...item, quantity: e.target.value })} /></label>{product.error && <p role="alert">{product.error}</p>}<ColorChoice label={`Cor da estrutura de ${name}`} options={colors?.structureColors} value={item.structureColor} onChange={value => update({ ...item, structureColor: value })} />{(colors?.plateHolderColors?.length || 0) > 0 && <ColorChoice label={`Cor dos anilheiros de ${name}`} options={colors?.plateHolderColors} value={item.plateHolderColor} onChange={value => update({ ...item, plateHolderColor: value })} />}{(colors?.plateHolderTypes?.length || 0) > 0 && <ColorChoice label={`Tipo de anilheiro de ${name}`} options={colors?.plateHolderTypes} value={item.plateHolderType} onChange={value => update({ ...item, plateHolderType: value })} />}{colors?.upholsteryConfigurable !== false && <ColorChoice label={`Cor do estofado de ${name}`} options={colors?.upholsteryColors} value={item.upholsteryColor} onChange={value => update({ ...item, upholsteryColor: value })} />}<Button variant="outline" type="button" onClick={remove}>Remover equipamento</Button></div>
}
