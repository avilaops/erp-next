"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SearchInput } from "@/components/search-input"
import { DataTable } from "@/components/workspace/data-table"
import { CurrencyCell, EmptyState, FilterField, ResponsiveTable, SearchToolbar, SortableTableHeader } from "@/components/workspace/list-layout"
import { useTableSort } from "@/components/workspace/use-table-sort"
import { useCommand, useResource } from "@/hooks/use-operation"
import { useNavigationGuard } from "@/components/shell/navigation-guard"
import { normalizeDecimal } from "@/lib/decimal-input"
import { erpFetch } from "@/lib/api/client"
import { states } from "@/features/commercial-settings/commercial-parameters"
import { Lookup, type Choice } from "@/features/sales/orders"
import { AccountSelect, CashNav, controlClass, Failure, SaleReceipt } from "./pos-shared"
import { amount, cents, cartCents, decimal, lineCents, money, methodNames, type Account, type CartItem, type CashSession, type Envelope, type Listing, type Payment, type Product, type Sale } from "./pos-model"

export function PointOfSale() {
  const [register, setRegister] = useState("Principal")
  const [draftRegister, setDraftRegister] = useState("Principal")
  const current = useResource<Envelope<CashSession | null>>(`/api/erp/pos/sessions/current?register=${encodeURIComponent(register)}`)
  const accounts = useResource<Listing<Account>>("/api/erp/financial-accounts?status=active&limit=100")
  const company = useResource<{ tenantId: string; data: { state: string } }>("/api/erp/company")
  return <div className="space-y-5">
    <CashNav id={current.value?.data?.id} />
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); if (draftRegister.trim() && (draftRegister.trim() === register || !document.querySelector("[data-pos-dirty=true]") || window.confirm("Descartar a venda em andamento e consultar outro caixa?"))) setRegister(draftRegister.trim()) }}><label className="grid min-w-0 flex-1 gap-1.5 text-xs font-medium sm:max-w-sm">Caixa<Input value={draftRegister} maxLength={80} onChange={e => setDraftRegister(e.target.value)} required /></label><Button type="submit" variant="outline">Consultar caixa</Button></form>
    {current.loading && !current.value ? <p role="status">Consultando caixa…</p> : current.error || !current.value ? <Failure message={current.error || "Caixa indisponível"} status={current.status} retry={current.reload} /> : accounts.loading && !accounts.value ? <p role="status">Consultando contas financeiras…</p> : accounts.error || accounts.value?.tenantId !== current.value.tenantId ? <Failure message={accounts.error || "Não foi possível conferir as contas desta empresa"} retry={accounts.reload} /> : company.loading && !company.value ? <p role="status">Consultando UF da empresa…</p> : current.value.data ? <Checkout key={`${current.value.tenantId}:${current.value.data.id}`} snapshot={current.value as Envelope<CashSession>} initialDestination={company.value?.tenantId === current.value.tenantId && states.some(state => state === company.value?.data.state) ? company.value.data.state : ""} accounts={accounts.value?.data || []} reload={current.reload} /> : current.value.canEdit ? <Opening register={register} tenant={current.value.tenantId} accounts={accounts.value?.data || []} reload={current.reload} /> : <p>Não há caixa aberto. Sua permissão permite consultar as operações.</p>}
  </div>
}

function Opening({ register, tenant, accounts, reload }: { register: string; tenant: string; accounts: Account[]; reload: () => void }) {
  const [account, setAccount] = useState("")
  const [opening, setOpening] = useState("0,00")
  const command = useCommand()
  const frozen = command.busy || command.uncertain || command.stale
  return <form className="max-w-xl space-y-4 rounded-lg border bg-muted/20 p-4" onSubmit={async e => { e.preventDefault(); const value = amount(opening); if (!account || !value) return; const saved = await command.send<Envelope<CashSession>>("/api/erp/pos/sessions", tenant, { register, cashAccountId: account, openingAmount: value }); if (saved?.tenantId === tenant && saved.data.id) reload() }}>
    <div><h2 className="font-semibold">Abrir caixa</h2><p className="mt-1 text-sm text-muted-foreground">Informe o dinheiro contado na abertura. A conta financeira deve ter saldo para esse valor.</p></div>
    <fieldset disabled={frozen} className="grid gap-3 sm:grid-cols-2"><AccountSelect label="Conta do caixa" accounts={accounts} cashOnly value={account} onChange={setAccount} /><label className="grid gap-1.5 text-xs font-medium">Saldo de abertura (R$)<Input required inputMode="decimal" value={opening} onChange={e => setOpening(e.target.value)} /></label></fieldset>
    {!accounts.some(value => value.accountType === "cash") && <p className="text-sm">Cadastre uma <Link className="text-primary underline" href="/cadastros/contas-financeiras">conta financeira do tipo caixa</Link> antes de abrir o PDV.</p>}
    {command.error && <Failure message={command.error} status={command.status} />}
    <Button type="submit" disabled={command.busy || command.stale || !account}>{command.busy ? "Abrindo…" : command.uncertain ? "Conferir abertura" : "Abrir caixa"}</Button>
    {command.stale && <Button type="button" variant="outline" onClick={reload}>Atualizar caixa</Button>}
  </form>
}

function Checkout({ snapshot, initialDestination, accounts, reload }: { snapshot: Envelope<CashSession>; initialDestination: string; accounts: Account[]; reload: () => void }) {
  const session = snapshot.data
  const params = useSearchParams()
  const router = useRouter()
  const table = useTableSort(["name", "price"], { by: "name", order: "asc" }, "products")
  const search = params.get("productSearch") || ""
  const rawOffset = Number(params.get("productOffset") || 0)
  const offset = Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0
  function updateProducts(values: { productSearch?: string; productOffset?: number }) {
    const next = new URLSearchParams(window.location.search)
    for (const [key, value] of Object.entries(values)) { if (value !== "" && value !== 0) next.set(key, String(value)); else next.delete(key) }
    router.replace(`${window.location.pathname}${next.size ? `?${next}` : ""}${window.location.hash}`, { scroll: false })
  }
  const [destination, setDestination] = useState(initialDestination)
  const [taxpayer, setTaxpayer] = useState("false")
  const [cart, setCart] = useState<CartItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([{ method: "cash", accountId: session.cashAccountId, amount: null, tendered: "" }])
  const [customer, setCustomer] = useState<Choice | null>(null)
  const [receipt, setReceipt] = useState<Sale | null>(null)
  const receiptRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState("")
  const [refreshingPrices, setRefreshingPrices] = useState(false)
  const command = useCommand()
  const productParams = new URLSearchParams(table.query)
  for (const [key, value] of Object.entries({ search, destination, taxpayer, offset: String(offset), limit: "15" })) productParams.set(key, value)
  const page = useResource<Listing<Product>>(`/api/erp/pos/products?${productParams}`)
  const frozen = !snapshot.canEdit || session.status !== "open" || command.busy || command.uncertain || command.stale || refreshingPrices
  const total = cartCents(cart)
  const payValue = (payment: Payment) => payment.amount === null && payments.length === 1 ? decimal(total || 0) : payment.amount || ""
  const paid = payments.reduce((value, payment) => value + (cents(payValue(payment)) || 0), 0)
  const change = payments.reduce((value, payment) => value + (payment.method === "cash" ? Math.max(0, (cents(payment.tendered) ?? cents(payValue(payment)) ?? 0) - (cents(payValue(payment)) || 0)) : 0), 0)
  useNavigationGuard(cart.length || command.uncertain ? "Há uma venda em andamento. Sair sem concluir?" : null)
  useEffect(() => {
    if (!receipt) return
    receiptRef.current?.scrollIntoView({ block: "start" })
    receiptRef.current?.focus({ preventScroll: true })
  }, [receipt])
  function updatePayment(index: number, patch: Partial<Payment>) { setPayments(values => values.map((value, n) => n === index ? { ...value, ...patch } : value)); setError(""); command.reset() }
  function add(product: Product) { setReceipt(null); setCart(values => values.some(value => value.id === product.id) ? values.map(value => value.id === product.id ? { ...value, quantity: String(Number(value.quantity) + 1) } : value) : [...values, { ...product, quantity: "1" }]); setError(""); command.reset() }
  async function refreshPrices() {
    if (command.uncertain || refreshingPrices) return
    setRefreshingPrices(true); setError("")
    try {
      const updated: CartItem[] = []
      for (let index = 0; index < cart.length; index += 4) {
        updated.push(...await Promise.all(cart.slice(index, index + 4).map(async item => {
          const response = await erpFetch(`/api/erp/pos/products?${new URLSearchParams({ search: item.sku, destination, taxpayer, offset: "0", limit: "100" })}`, { cache: "no-store" })
          const value: Listing<Product> = await response.json()
          const product = value.data?.find(product => product.id === item.id)
          if (!response.ok || value.tenantId !== snapshot.tenantId || !product?.pricingAvailable) throw Error(`Confira o preço e a disponibilidade de ${item.name}.`)
          return { ...product, quantity: item.quantity }
        })))
      }
      setCart(updated); command.reset(); page.reload(); reload()
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível atualizar os preços.") }
    finally { setRefreshingPrices(false) }
  }
  async function complete(e: React.FormEvent) {
    e.preventDefault()
    if (frozen && !command.uncertain) return
    const normalized = cart.map(item => ({ productId: item.id, quantity: normalizeDecimal(item.quantity, 6) }))
    const tenders = payments.map(payment => ({ method: payment.method, accountId: payment.method === "cash" ? session.cashAccountId : payment.accountId, amount: amount(payValue(payment)), tendered: payment.method === "cash" ? amount(payment.tendered || payValue(payment)) : null }))
    if (!cart.length || !total || normalized.some(item => !item.quantity || Number(item.quantity) <= 0) || tenders.some(payment => !payment.amount || Number(payment.amount) <= 0 || !payment.accountId || payment.method === "cash" && (!payment.tendered || Number(payment.tendered) < Number(payment.amount))) || paid !== total) { setError("Confira as quantidades e os pagamentos. A soma dos pagamentos deve corresponder ao total e o dinheiro recebido deve cobrir a parcela em dinheiro."); return }
    const result = await command.send<Envelope<Sale> & { session: CashSession }>(`/api/erp/pos/sessions/${session.id}/sales`, snapshot.tenantId, { items: normalized, payments: tenders, expectedTotal: decimal(total), destination, taxpayer: taxpayer === "true", customerId: customer?.id || null }, `"${session.revision}"`)
    if (result?.tenantId === snapshot.tenantId && result.data.sessionId === session.id) { setReceipt(result.data); setCart([]); setPayments([{ method: "cash", accountId: session.cashAccountId, amount: null, tendered: "" }]); setCustomer(null); page.reload(); reload() }
  }
  return <div className="space-y-4" data-pos-dirty={cart.length > 0 || command.uncertain}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-y py-3"><div><h2 className="font-semibold">Caixa {session.register}</h2><p className="text-xs text-muted-foreground">Dinheiro esperado: {money(session.totals.expectedCash)}</p></div><Link className="text-sm text-primary underline" href={`/vendas/pdv/fechamento?caixa=${session.id}`}>Conferir e fechar caixa</Link></div>
    {!snapshot.canEdit && <p role="status">Somente consulta. As operações exigem permissão para gerenciar o PDV.</p>}
    {receipt && <div ref={receiptRef} tabIndex={-1} className="scroll-mt-20 outline-none" aria-label="Venda registrada"><SaleReceipt sale={receipt} register={session.register} onClose={() => setReceipt(null)} /></div>}
    <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)]">
      <div className="min-w-0 space-y-5"><section className="space-y-3" aria-label="Catálogo do PDV">
        <SearchToolbar pending={frozen || page.loading} canClear={!!search} onClear={() => updateProducts({ productSearch: "", productOffset: 0 })} onSubmit={event => { event.preventDefault(); updateProducts({ productSearch: String(new FormData(event.currentTarget).get("productSearch") || "").trim(), productOffset: 0 }) }}>
          <FilterField label="Buscar produto"><SearchInput name="productSearch" defaultValue={search} disabled={frozen} onSearch={value => updateProducts({ productSearch: value, productOffset: 0 })} placeholder="Nome ou código" /></FilterField><FilterField label="Destino"><select className={controlClass} disabled={frozen || cart.length > 0} value={destination} onChange={e => setDestination(e.target.value)}><option value="">Selecione a UF</option>{states.map(state => <option key={state}>{state}</option>)}</select></FilterField><FilterField label="Cliente contribuinte"><select className={controlClass} disabled={frozen || cart.length > 0} value={taxpayer} onChange={e => setTaxpayer(e.target.value)}><option value="false">Sem inscrição estadual</option><option value="true">Com inscrição estadual</option></select></FilterField>
        </SearchToolbar>
        {!destination ? <p className="text-sm text-muted-foreground">Selecione a UF de destino para consultar os produtos e preços.</p> : page.loading ? <p role="status">Consultando produtos e preços…</p> : page.error || page.value?.tenantId !== snapshot.tenantId ? <Failure message={page.error || "Não foi possível conferir os produtos desta empresa"} retry={page.reload} /> : <><ResponsiveTable label="Produtos disponíveis no PDV"><DataTable aria-label="Produtos disponíveis no PDV"><thead><tr><SortableTableHeader field="name" sort={table.sort} onSort={table.toggle}>Produto</SortableTableHeader><SortableTableHeader field="price" sort={table.sort} onSort={table.toggle}>Preço</SortableTableHeader><th scope="col"><span className="sr-only">Adicionar</span></th></tr></thead><tbody>{page.value?.data.map(product => <tr key={product.id}><td><span className="font-medium">{product.name}</span><span className="block text-xs text-muted-foreground">{product.sku} · Disponível: {Number(product.available).toLocaleString("pt-BR")} {product.unit}</span>{!product.pricingAvailable && <span className="block text-xs text-destructive">{product.pricingError || "Preço indisponível"}</span>}</td><CurrencyCell>{product.pricingAvailable ? money(product.unitPrice) : "—"}</CurrencyCell><td><Button size="sm" variant="outline" disabled={frozen || !product.pricingAvailable || Number(product.available) <= 0} aria-label={`Adicionar ${product.name}`} onClick={() => add(product)}>Adicionar</Button></td></tr>)}{!page.value?.data.length && <tr><td colSpan={3}><EmptyState filtered={!!search} title={search ? undefined : "Nenhum produto disponível"} description="Nenhum produto encontrado para este destino e esta pesquisa." /></td></tr>}</tbody></DataTable></ResponsiveTable><div className="flex items-center justify-between gap-3"><Button variant="outline" size="sm" disabled={!offset} onClick={() => updateProducts({ productOffset: Math.max(0, offset - 15) })}>Anterior</Button><span className="text-xs text-muted-foreground">{page.value?.total || 0} produto(s)</span><Button variant="outline" size="sm" disabled={offset + 15 >= (page.value?.total || 0)} onClick={() => updateProducts({ productOffset: offset + 15 })}>Próxima</Button></div></>}
      </section>
      <section className="space-y-3" aria-label="Venda em andamento"><h2 className="font-semibold">Itens da venda</h2>{!cart.length ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Adicione os produtos para iniciar a venda.</p> : <div className="max-w-full overflow-x-auto rounded-lg border"><DataTable aria-label="Itens da venda"><thead><tr><th>Produto</th><th>Quantidade</th><th className="text-right">Total</th><th><span className="sr-only">Remover</span></th></tr></thead><tbody>{cart.map(item => <tr key={item.id}><td className="min-w-36">{item.name}<span className="block text-xs text-muted-foreground">{item.sku} · {money(item.unitPrice)}</span></td><td><Input className="w-24" inputMode="decimal" aria-label={`Quantidade de ${item.name}`} disabled={frozen} value={item.quantity} onChange={e => { setCart(values => values.map(value => value.id === item.id ? { ...value, quantity: e.target.value } : value)); command.reset() }} /></td><td className="whitespace-nowrap text-right">{money(lineCents(item))}</td><td><Button size="sm" variant="ghost" disabled={frozen} aria-label={`Remover ${item.name}`} onClick={() => { setCart(values => values.filter(value => value.id !== item.id)); command.reset() }}>Remover</Button></td></tr>)}</tbody></DataTable></div>}</section>
      <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Identificar cliente (opcional)</summary><div className="pt-3"><Lookup endpoint="parties" label="cliente" searchOnly selectedName={customer?.legalName} choose={setCustomer} disabled={frozen} />{customer && <Button variant="ghost" onClick={() => setCustomer(null)}>Consumidor sem identificação</Button>}</div></details>
      </div>
      <form className="min-w-0 space-y-4 rounded-lg border bg-muted/15 p-4 xl:sticky xl:top-20" onSubmit={complete}>
        <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Pagamentos</h2><span className="text-lg font-semibold tabular-nums">{money(total || 0)}</span></div>
        <fieldset disabled={frozen} className="min-w-0 space-y-4">{payments.map((payment, index) => <div key={index} className="grid min-w-0 gap-3 border-t pt-3 sm:grid-cols-2"><label className="grid min-w-0 gap-1.5 text-xs font-medium">Forma de pagamento {index + 1}<select aria-label={`Forma de pagamento ${index + 1}`} className={controlClass} value={payment.method} onChange={e => updatePayment(index, { method: e.target.value as Payment["method"], accountId: e.target.value === "cash" ? session.cashAccountId : "", tendered: "" })}>{Object.entries(methodNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="grid gap-1.5 text-xs font-medium">Valor do pagamento {index + 1} (R$)<Input required inputMode="decimal" value={payValue(payment)} onChange={e => updatePayment(index, { amount: e.target.value })} /></label>{payment.method === "cash" ? <label className="grid gap-1.5 text-xs font-medium sm:col-span-2">Recebido em dinheiro {index + 1} (R$)<Input inputMode="decimal" placeholder="Mesmo valor da parcela" value={payment.tendered} onChange={e => updatePayment(index, { tendered: e.target.value })} /></label> : <div className="min-w-0 sm:col-span-2"><AccountSelect label={`Conta de recebimento ${index + 1}`} accounts={accounts.filter(account => account.accountType !== "cash")} value={payment.accountId} onChange={accountId => updatePayment(index, { accountId })} /></div>}{payments.length > 1 && <Button className="justify-self-start" size="sm" type="button" variant="ghost" onClick={() => setPayments(values => values.filter((_, n) => n !== index))}>Remover pagamento {index + 1}</Button>}</div>)}<Button type="button" variant="outline" onClick={() => { setPayments(values => values.map(value => value.amount === null ? { ...value, amount: payValue(value) } : value).concat({ method: "pix", accountId: "", amount: total && total > paid ? decimal(total - paid) : "", tendered: "" })); command.reset() }}>Adicionar pagamento</Button></fieldset>
        <dl className="space-y-2 border-t pt-3 text-sm"><div className="flex justify-between"><dt>Pagamentos</dt><dd>{money(paid)}</dd></div><div className="flex justify-between"><dt>{paid > (total || 0) ? "Acima do total" : "Falta receber"}</dt><dd>{money(Math.abs((total || 0) - paid))}</dd></div><div className="flex justify-between font-semibold"><dt>Troco em dinheiro</dt><dd>{money(change)}</dd></div></dl>
        {(error || command.error) && <Failure message={error || command.error} status={command.status} />}
        <Button className="w-full" type="submit" disabled={!snapshot.canEdit || command.busy || command.stale || !cart.length}>{command.busy ? "Registrando…" : command.uncertain ? "Conferir venda com o mesmo comando" : "Concluir venda"}</Button>
        {(command.stale || command.status === 409) && <Button type="button" variant="outline" onClick={refreshPrices} disabled={refreshingPrices}>Atualizar caixa e preços</Button>}
      </form>
    </div>
  </div>
}
