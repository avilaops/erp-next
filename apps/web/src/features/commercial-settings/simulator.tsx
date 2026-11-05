"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { erpFetch } from "@/lib/api/client"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RequestError } from "@/components/feedback/session-recovery"
import { useResource } from "@/hooks/use-operation"
import { useNavigationGuard } from "@/components/shell/navigation-guard"
import { states } from "./commercial-parameters"
import { discountFromEntry, hundredths, money, percent, parseSimulation, type Discount, type PublishedTable, type Simulation, type SimulationInput, type SimulatorOptions } from "./simulator-model"
import { SimulationResult } from "./simulator-result"
import { SimulationOrder } from "./simulator-order"

const selectClass = "min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3"

export function SalesSimulator() {
  const [line, setLine] = useState<"imported" | "national">("imported")
  const [version, setVersion] = useState("")
  const [locked, setLocked] = useState(false)
  const options = useResource<SimulatorOptions>(`/api/erp/sales-simulator/${line}${version ? `?versionId=${version}` : ""}`)
  useNavigationGuard(locked ? "A criação do pedido ainda não foi confirmada. Sair?" : null)
  return <main className="mx-auto max-w-7xl space-y-5 px-4 pb-24 pt-6">
    <PageHeader eyebrow="Vendas" title="Simulador de preços" description="Confira uma negociação usando os preços e parâmetros de uma tabela publicada." />
    <nav aria-label="Linha de produto" className="flex flex-wrap gap-2">{([["imported", "Importada"], ["national", "Nacional"]] as const).map(([value, label]) => <Button key={value} disabled={locked} variant={line === value ? "default" : "outline"} aria-pressed={line === value} onClick={() => { setLine(value); setVersion("") }}>{label}</Button>)}</nav>
    {options.loading ? <p role="status">Consultando tabelas publicadas…</p> : options.error ? <section role="alert" className="form-section space-y-3"><p><RequestError message={options.error} status={options.status} /></p><Button onClick={options.reload}>Tentar novamente</Button></section> : options.value && <>
      <div className="flex flex-wrap items-end gap-4"><label className="grid gap-2">Tabela publicada<select className={selectClass} value={options.value.data?.id || ""} disabled={locked || !options.value.versions.length} onChange={event => setVersion(event.target.value)}>{options.value.versions.map(row => <option key={row.id} value={row.id}>v{row.version} · {new Date(row.publishedAt).toLocaleDateString("pt-BR")}</option>)}</select></label><Link className="py-2 text-primary underline" href="/preferencias/tabela-precos">Gerenciar tabelas</Link></div>
      {!options.value.data ? <p className="form-section">Nenhuma tabela publicada nesta linha. A gestão precisa publicar uma versão antes de simular.</p> : !options.value.data.items.length ? <p className="form-section">Esta versão não tem equipamentos ativos com unidade compatível. Confira o cadastro ou selecione outra versão.</p> : <SimulatorForm key={`${options.value.tenantId}:${line}:${options.value.data.id}`} table={options.value.data} tenantId={options.value.tenantId} line={line} canCreate={options.value.canCreate} onLocked={setLocked} />}
    </>}
  </main>
}

function SimulatorForm({ table, tenantId, line, canCreate, onLocked }: {
  table: PublishedTable; tenantId: string; line: string; canCreate: boolean; onLocked: (value: boolean) => void
}) {
  const [productId, setProductId] = useState("")
  const [search, setSearch] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [destination, setDestination] = useState(table.originState)
  const [taxpayer, setTaxpayer] = useState("")
  const [kind, setKind] = useState<Discount["kind"]>("percent")
  const [discount, setDiscount] = useState("0")
  const [freight, setFreight] = useState("0")
  const [value, setValue] = useState<Simulation | null>(null)
  const [busy, setBusy] = useState(false)
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState("")
  const generation = useRef(0)
  const product = table.items.find(item => item.productId === productId)
  const frozen = busy || locked
  function invalidate() { generation.current += 1; setValue(null); setError("") }
  function changeKind(next: Discount["kind"]) {
    const current = discountFromEntry(kind, discount)
    const count = /^\d+$/.test(quantity) ? Number(quantity) : 0
    if (current && product && count) {
      const total = product.priceWithoutIpiCents * count
      const rate = kind === "percent" ? current.value / 10000 : kind === "amount" ? current.value / total : 1 - current.value / (product.priceWithIpiCents * count)
      const number = next === "percent" ? rate * 100 : next === "amount" ? total * rate / 100 : product.priceWithIpiCents * count * (1 - rate) / 100
      setDiscount(Math.max(0, number).toFixed(2).replace(".", ","))
    } else setDiscount(next === "target" ? "" : "0")
    setKind(next); invalidate()
  }
  async function simulate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (frozen || !product) return
    const entry = discountFromEntry(kind, discount)
    const freightCents = hundredths(freight)
    if (!entry || freightCents === null || !/^\d{1,7}$/.test(quantity) || Number(quantity) < 1 || Number(quantity) > 1000000 || !taxpayer) {
      setError("Confira quantidade, inscrição estadual, desconto e frete."); return
    }
    const input: SimulationInput = { versionId: table.id, productId, quantity: Number(quantity), destination, taxpayer: taxpayer === "yes", discount: entry, freightCents }
    const requestGeneration = ++generation.current
    setBusy(true); setValue(null); setError("")
    try {
      const response = await erpFetch(`/api/erp/sales-simulator/${line}/quote`, { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId }, body: JSON.stringify(input) })
      const result = await response.json()
      if (!response.ok) throw Error(result.title || "Não foi possível simular.")
      const parsed = parseSimulation(result, tenantId, line, input)
      if (requestGeneration === generation.current) setValue(parsed)
    } catch (reason) { if (requestGeneration === generation.current) setError(reason instanceof Error ? reason.message : "Simulação indisponível.") }
    finally { setBusy(false) }
  }
  return <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.9fr)]">
    <form className="form-section min-w-0 space-y-5" onSubmit={simulate}>
      <fieldset disabled={frozen} className="min-w-0 space-y-4">
        <legend className="mb-3 font-semibold">Equipamento e condições</legend>
        <label className="grid gap-2">Buscar equipamento<Input type="search" placeholder="Nome ou código" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <label className="grid gap-2">Equipamento<select required className={selectClass} value={productId} onChange={event => { setProductId(event.target.value); invalidate() }}><option value="">Selecione o equipamento</option>{table.items.filter(item => item.productId === productId || `${item.sku} ${item.name}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR"))).map(item => <option key={item.productId} value={item.productId}>{item.sku} · {item.name} · {money(item.priceWithIpiCents)}</option>)}</select></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2">Quantidade<Input required inputMode="numeric" value={quantity} onChange={event => { setQuantity(event.target.value); invalidate() }} /></label><label className="grid gap-2">Destino<select className={selectClass} value={destination} onChange={event => { setDestination(event.target.value); invalidate() }}>{states.map(state => <option key={state}>{state}</option>)}</select></label></div>
        <label className="grid gap-2">Inscrição estadual<select required className={selectClass} value={taxpayer} onChange={event => { setTaxpayer(event.target.value); invalidate() }}><option value="">Informe a condição do cliente</option><option value="no">Cliente sem IE</option><option value="yes">Cliente com IE</option></select></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-2">Forma de informar o desconto<select className={selectClass} value={kind} onChange={event => changeKind(event.target.value as Discount["kind"])}><option value="percent">Desconto em %</option><option value="amount">Desconto em R$ (sem IPI)</option><option value="target">Cliente quer pagar</option></select></label><label className="grid gap-2">{kind === "percent" ? "Desconto em %" : kind === "amount" ? "Desconto em R$" : "Cliente quer pagar (total com IPI)"}<Input required inputMode="decimal" value={discount} onChange={event => { setDiscount(event.target.value); invalidate() }} /></label></div>
        {kind === "percent" && <label className="grid gap-2 text-sm">Ajustar desconto de 0 a 60%<input aria-label="Desconto de 0 a 60%" type="range" min="0" max="60" step="0.5" value={Math.min(60, (hundredths(discount) || 0) / 100)} onChange={event => { setDiscount(event.target.value.replace(".", ",")); invalidate() }} /></label>}
        <p className="rounded-lg bg-muted p-3 text-sm">Desconto livre até {percent(table.freeDiscountBps)}. Acima disso, ou abaixo da meta de lucro, o pedido exige aprovação.</p>
        <details><summary className="cursor-pointer py-2 text-primary">Frete por nossa conta</summary><label className="mt-2 grid gap-2">Valor do frete que a empresa paga (R$)<Input inputMode="decimal" required value={freight} onChange={event => { setFreight(event.target.value); invalidate() }} /></label></details>
        <Button type="submit" disabled={!product}>{busy ? "Simulando…" : "Simular"}</Button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <p className="text-xs text-muted-foreground">Tabela v{table.version}. Simulação gerencial sem emissão fiscal. Simular não grava dados.</p>
    </form>
    <div className="min-w-0 space-y-5">{value ? <><SimulationResult value={value} imported={line === "imported"} />{canCreate && product && <SimulationOrder key={value.digest} value={value} equipment={product} line={line} onLocked={next => { setLocked(next); onLocked(next) }} />}</> : <section className="form-section"><h2 className="font-semibold">Resultado</h2><p className="mt-2 text-muted-foreground">Selecione o equipamento, informe as condições e simule para conferir o resultado.</p></section>}</div>
  </div>
}
