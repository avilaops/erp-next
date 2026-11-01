"use client"

import { erpFetch } from "@/lib/api/client"

import type { Schema } from "@/lib/api/types"

import { decimalPattern } from "@/lib/decimal-input"

import { RequestError } from "@/components/session-recovery"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useId, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ProductThumbnail } from "@/features/catalog/product-thumbnail"
import { quantity, useCommand, useResource } from "./use-operation"

type Order = Schema<"OrderSummary">
type Item = Schema<"OrderLine">
type Detail = Schema<"OrderSnapshot">
type Listing = Schema<"OrderList">
type Choice = { id: string; legalName?: string; name?: string; sku?: string; basePrice?: string; unit?: string; structureColors?: string[]; upholsteryColors?: string[]; hasPhoto?: boolean }
type SelectedItem = Choice & { quantity: string; preserved: boolean; structureColor: string; upholsteryColor: string }
const labels: Record<string, string> = { draft: "Rascunho", confirmed: "Reservado", completed: "Concluído", cancelled: "Cancelado" }
const linkClass = "font-medium text-primary underline underline-offset-4"

function ColorChoice({ label, options = [], value, onChange }: { label: string; options?: string[]; value: string; onChange: (value: string) => void }) {
  const id = useId()
  return <div className="grid min-w-0 gap-2 text-sm">
    <label htmlFor={id}>{label}</label>
    <select id={id} className="min-h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3" value={value} required={options.length > 0} disabled={!options.length && !value} onChange={event => onChange(event.target.value)}>
      <option value="">{options.length ? "Escolha uma cor" : "Sem opções cadastradas"}</option>
      {value && !options.includes(value) && <option value={value}>{value} · seleção registrada</option>}
      {options.map(color => <option key={color} value={color}>{color}</option>)}
    </select>
  </div>
}

function Lookup({ endpoint, label, disabled, choose }: { endpoint: string; label: string; disabled: boolean; choose: (value: Choice) => void }) {
  const [query, setQuery] = useState({ q: "", offset: 0 })
  const params = new URLSearchParams({ q: query.q, offset: String(query.offset), limit: "10", status: "active" })
  if (endpoint === "parties") params.set("role", "customer")
  const result = useResource<{ data: Choice[]; total: number; tenantId: string }>(`/api/erp/${endpoint}?${params}`)
  return <section className="min-w-0 space-y-3 rounded-xl border p-4" aria-label={`Seleção de ${label}`}>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); setQuery({ q: String(new FormData(event.currentTarget).get("q") || ""), offset: 0 }) }}>
      <label className="min-w-0 flex-1 space-y-2">Buscar {label}<Input name="q" maxLength={160} disabled={disabled} /></label><Button type="submit" disabled={disabled || result.loading}>Pesquisar {label}</Button>
    </form>
    {result.loading ? <p role="status">Consultando {label}…</p> : result.error ? <p role="alert"><RequestError message={result.error} status={result.status} /></p> : <>
      <ul className="space-y-2">{result.value?.data.map(value => <li className="min-w-0" key={value.id}><Button className="h-auto max-w-full gap-3 break-all whitespace-normal text-left" variant="outline" disabled={disabled} onClick={() => choose(value)}>{endpoint === "products" && <ProductThumbnail id={value.id} name={value.name || value.sku || "Produto"} tenantId={result.value!.tenantId} hasPhoto={value.hasPhoto} decorative />}<span className="min-w-0">Selecionar {value.legalName || value.name}{value.sku ? ` · ${value.sku}` : ""}</span></Button></li>)}</ul>
      {!result.value?.data.length && <p>Nenhum resultado encontrado.</p>}
      <div className="flex flex-wrap justify-between gap-2"><Button variant="outline" disabled={disabled || !query.offset} onClick={() => setQuery({ ...query, offset: Math.max(0, query.offset - 10) })}>Anterior {label}</Button><Button variant="outline" disabled={disabled || query.offset + 10 >= (result.value?.total || 0)} onClick={() => setQuery({ ...query, offset: query.offset + 10 })}>Próximo {label}</Button></div>
    </>}
  </section>
}

export function Orders({ id, create = false, edit = false }: { id?: string; create?: boolean; edit?: boolean }) {
  if (create || edit) return <OrderEditor id={edit ? id : undefined} />
  if (id) return <OrderDetail key={id} id={id} />
  return <OrderList />
}

function OrderList() {
  const [offset, setOffset] = useState(0)
  const result = useResource<Listing>(`/api/erp/orders?offset=${offset}&limit=25`)
  return <><PageHeader eyebrow="Vendas" title="Pedidos de venda" description="Rascunho, reserva e conclusão comercial com geração de conta a receber. Não emite documento fiscal." />
    <section className="form-section min-w-0 space-y-4">
      {result.value?.canEdit && <Link className={linkClass} href="/vendas/pedidos/novo">Novo pedido</Link>}
      {result.loading ? <p role="status">Carregando pedidos…</p> : result.error ? <div role="alert"><p><RequestError message={result.error} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button></div> : <>
        <p>{result.value?.total || 0} pedido(s)</p>
        <ul className="grid min-w-0 gap-3 sm:grid-cols-2">{result.value?.data.map(order => <li className="min-w-0 space-y-2 rounded-xl border p-4" key={order.id}><Link className={`${linkClass} break-words`} href={`/vendas/pedidos/${order.id}`}>Pedido de {order.customerName}</Link><p>{labels[order.status]} · R$ {order.amount.replace(".", ",")}</p><p className="break-all text-xs text-muted-foreground">{order.id}</p></li>)}</ul>
        <div className="flex flex-wrap justify-between gap-3"><Button variant="outline" disabled={!offset} onClick={() => setOffset(value => value - 25)}>Anterior</Button><Button variant="outline" disabled={offset + 25 >= (result.value?.total || 0)} onClick={() => setOffset(value => value + 25)}>Próxima</Button></div>
      </>}
    </section>
  </>
}

function OrderEditor({ id }: { id?: string }) {
  const access = useResource<Listing | Detail>(id ? `/api/erp/orders/${id}` : "/api/erp/orders?limit=1")
  if (access.loading) return <><PageHeader eyebrow="Vendas" title={id ? "Editar pedido de venda" : "Novo pedido de venda"} description="Consulte os dados e as permissões antes de editar o pedido." /><p role="status">Carregando rascunho e permissões…</p></>
  if (access.error || !access.value) return <><PageHeader eyebrow="Vendas" title={id ? "Editar pedido de venda" : "Novo pedido de venda"} description="Consulte os dados e as permissões antes de editar o pedido." /><Link className={linkClass} href="/vendas/pedidos">Voltar à lista</Link><section className="form-section space-y-3"><p role="alert"><RequestError message={access.error || "Pedido indisponível"} status={access.status} /></p><Button onClick={access.reload}>Tentar novamente</Button></section></>
  const initial = "items" in access.value ? access.value : undefined
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
  const [items, setItems] = useState<SelectedItem[]>(() => initial?.items.map(item => ({ id: item.productId, name: item.name, sku: item.sku, unit: item.unit, basePrice: item.unitPrice, quantity: item.quantity, preserved: true, structureColor: item.structureColor || "", upholsteryColor: item.upholsteryColor || "" })) || [])
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
      return { id: item.productId, structureColors: value.data.structureColors || [], upholsteryColors: value.data.upholsteryColors || [], hasPhoto: value.data.hasPhoto }
    })).then(products => {
      if (!controller.signal.aborted) setItems(previous => previous.map(item => ({ ...item, ...products.find(product => product.id === item.id) })))
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Falha ao consultar cores") })
    return () => controller.abort()
  }, [initial, tenantId])
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty || command.uncertain) event.preventDefault() }
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent)
  }, [dirty, command.uncertain])
  return <><PageHeader eyebrow="Vendas" title={initial ? "Editar rascunho do pedido" : "Novo pedido"} description={initial ? "Itens mantidos preservam os preços registrados. Novos itens recebem o preço do catálogo ao salvar." : "Preços base do catálogo são fixados no rascunho. Sem descontos, frete ou apuração fiscal nesta primeira etapa."} />
    <section className="form-section min-w-0 space-y-5">
        <Link className={linkClass} href={initial ? `/vendas/pedidos/${initial.data.id}` : "/vendas/pedidos"} onClick={event => { if ((dirty || command.uncertain) && !window.confirm("Sair sem confirmar as alterações deste rascunho?")) event.preventDefault() }}>Voltar aos pedidos</Link>
        <div className="grid min-w-0 gap-4 lg:grid-cols-2"><Lookup endpoint="parties" label="cliente" disabled={frozen} choose={value => { setCustomer(value.id === originalCustomer?.id ? originalCustomer : value); setDirty(true) }} /><Lookup endpoint="products" label="produto" disabled={frozen || items.length >= 100} choose={value => {
          if (items.some(item => item.id === value.id)) { setError("Produto já incluído. Altere a quantidade no item existente."); return }
          const saved = initial?.items.find(item => item.productId === value.id)
          const choice = saved ? { id: saved.productId, name: saved.name, sku: saved.sku, unit: saved.unit, basePrice: saved.unitPrice } : value
          setItems(previous => [...previous, { ...value, ...choice, quantity: "1", preserved: Boolean(saved), structureColor: saved?.structureColor || "", upholsteryColor: saved?.upholsteryColor || "" }]); setDirty(true); setError("")
        }} /></div>
        <p className="break-words">Cliente selecionado: {customer?.legalName || "Nenhum"}</p>
        <form className="space-y-4" onSubmit={async event => {
          event.preventDefault(); setError("")
          if (!customer || !items.length || items.some(item => !quantity(item.quantity))) { setError("Selecione cliente e itens com quantidades decimais válidas."); return }
          const value = await command.send<Detail>(initial ? `/api/erp/orders/${initial.data.id}` : "/api/erp/orders", tenantId, { customerId: customer.id, dueDate, items: items.map(item => ({ productId: item.id, quantity: quantity(item.quantity), structureColor: item.structureColor, upholsteryColor: item.upholsteryColor })) }, initial ? etag : "", initial ? "PUT" : "POST")
          if (value) { setDirty(false); router.replace(`/vendas/pedidos/${value.data.id}`) }
        }}>
          <fieldset disabled={frozen} className="min-w-0 space-y-4">
            <label className="block min-w-0 space-y-2">Vencimento da conta a receber<Input type="date" required value={dueDate} onChange={event => { setDueDate(event.target.value); setDirty(true) }} /></label>
            {items.map(item => <div key={item.id} role="group" aria-label={`Item do pedido: ${item.name}`} className="min-w-0 space-y-3 rounded-xl border p-4"><div className="flex min-w-0 items-center gap-3"><ProductThumbnail id={item.id} name={item.name || item.sku || "Produto"} tenantId={tenantId} hasPhoto={item.hasPhoto} decorative /><strong className="min-w-0 break-words">{item.name}</strong></div><p className="break-all text-sm">SKU {item.sku} · {item.preserved ? "Preço registrado" : "Preço base consultado"}: R$ {item.basePrice?.replace(".", ",")}</p><label className="block min-w-0 space-y-2">Quantidade de {item.name}<Input required inputMode="decimal" pattern={decimalPattern(6)} maxLength={19} value={item.quantity} onChange={event => { setItems(previous => previous.map(value => value.id === item.id ? { ...value, quantity: event.target.value } : value)); setDirty(true) }} /></label>
              <div className="grid gap-4 sm:grid-cols-2"><ColorChoice label={`Cor da estrutura de ${item.name}`} options={item.structureColors} value={item.structureColor} onChange={color => { setItems(previous => previous.map(value => value.id === item.id ? { ...value, structureColor: color } : value)); setDirty(true) }} /><ColorChoice label={`Cor do estofado de ${item.name}`} options={item.upholsteryColors} value={item.upholsteryColor} onChange={color => { setItems(previous => previous.map(value => value.id === item.id ? { ...value, upholsteryColor: color } : value)); setDirty(true) }} /></div>
              <p className="text-xs text-muted-foreground">O acabamento fica registrado neste item. O saldo de estoque continua controlado por produto.</p>
              <Button type="button" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal break-words text-left" onClick={() => { setItems(previous => previous.filter(value => value.id !== item.id)); setDirty(true) }}>Remover {item.name}</Button></div>)}
          </fieldset>
          {(error || command.error) && <p role="alert"><RequestError message={error || command.error} status={error ? undefined : command.status} /></p>}
          {command.uncertain && <p role="status">Confirmação pendente. A repetição usa o mesmo comando.</p>}
          {command.stale && <Button type="button" variant="outline" onClick={() => { if (!dirty || window.confirm("Recarregar e descartar as alterações locais deste rascunho?")) { command.reset(); reload() } }}>Recarregar rascunho</Button>}
          <Button type="submit" disabled={command.busy || command.stale || !customer || !items.length}>{command.busy ? "Confirmando…" : command.uncertain ? initial ? "Conferir alteração do pedido" : "Conferir criação do pedido" : initial ? "Salvar rascunho" : "Criar rascunho"}</Button>
        </form>
    </section>
  </>
}

function OrderDetail({ id }: { id: string }) {
  const result = useResource<Detail>(`/api/erp/orders/${id}`)
  const access = useResource<{ permissions: string[] }>("/api/erp/me")
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
  return <><PageHeader eyebrow="Vendas" title="Pedido de venda" description="Concluir registra saída de estoque e conta a receber. Não emite NF-e nem comprova entrega física." /><Link className={linkClass} href="/vendas/pedidos">Voltar aos pedidos</Link>
    <section className="form-section mt-5 min-w-0 space-y-4">
      {notice && <p role="status">{notice}</p>}
      {result.loading ? <p role="status">Carregando pedido…</p> : result.error ? <p role="alert"><RequestError message={result.error} status={result.status} /></p> : value && <>
        <h2 className="break-words font-semibold">{value.data.customerName}</h2><p>Situação: {labels[value.data.status]}</p><p>Total comercial: R$ {value.data.amount.replace(".", ",")}</p><p>Vencimento: {value.data.dueDate}</p><p className="break-all text-sm text-muted-foreground">Pedido {id} · Revisão {value.data.revision}</p>
        <Link className={linkClass} href={`/vendas/pedidos/${id}/contratos`}>Contratos do pedido</Link>
        {["confirmed", "completed"].includes(value.data.status) && ["fiscal.nfe.read", "fiscal.nfe.manage", "catalog.parties.read", "catalog.products.read"].every(permission => access.value?.permissions.includes(permission)) && <Link className={linkClass} href={`/fiscal/notas-saida/nova?pedido=${id}`}>Preparar NF-e deste pedido</Link>}
        {value.data.status === "draft" && value.canEdit && !command.busy && !command.uncertain && !command.stale && <Link className={linkClass} href={`/vendas/pedidos/${id}/editar`}>Editar rascunho</Link>}
        <ul className="space-y-3">{value.items.map(item => <li className="min-w-0 space-y-2 rounded-xl border p-4" key={item.productId}><div className="flex min-w-0 items-center gap-3"><ProductThumbnail id={item.productId} name={item.name} tenantId={value.tenantId} decorative /><strong className="min-w-0 break-words">{item.name}</strong></div><p className="text-xs text-muted-foreground">Foto de referência do cadastro atual.</p>{item.structureColor && <p className="break-words text-sm">Estrutura: {item.structureColor}</p>}{item.upholsteryColor && <p className="break-words text-sm">Estofado: {item.upholsteryColor}</p>}<p className="break-words text-sm">Quantidade: {item.quantity} {item.unit}</p><p className="break-words text-sm">Unitário: R$ {item.unitPrice.replace(".", ",")}</p><p className="break-words text-sm">Total do item: R$ {item.amount.replace(".", ",")}</p></li>)}</ul>
        {!value.canEdit && <p>Somente consulta.</p>}
        {command.error && <p role="alert"><RequestError message={command.error} status={command.status} /></p>}
        {command.stale && <Button variant="outline" onClick={() => { command.reset(); result.reload() }}>Recarregar pedido</Button>}
        {command.uncertain ? <Button disabled={command.busy} onClick={() => act(pendingAction)}>Repetir confirmação do pedido</Button> : value.canEdit && <div className="flex flex-wrap gap-3">
          {value.data.status === "draft" && <Button disabled={command.busy || command.stale || !result.etag} onClick={() => act("confirm")}>Confirmar e reservar estoque</Button>}
          {value.data.status === "confirmed" && <Button className="h-auto max-w-full whitespace-normal" disabled={command.busy || command.stale || !result.etag} onClick={() => { if (window.confirm("Registrar saída de estoque e gerar a conta a receber deste pedido?")) void act("complete") }}>Concluir e gerar conta a receber</Button>}
          {["draft", "confirmed"].includes(value.data.status) && <Button variant="outline" disabled={command.busy || command.stale || !result.etag} onClick={() => { if (window.confirm("Cancelar o pedido e liberar sua reserva, se houver?")) void act("cancel") }}>Cancelar pedido</Button>}
        </div>}
        {value.data.status === "completed" && <Link className={linkClass} href="/financeiro/contas-receber">Consultar contas a receber</Link>}
      </>}
    </section>
  </>
}
