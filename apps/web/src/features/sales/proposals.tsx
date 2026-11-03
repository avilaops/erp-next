"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useId, useState, type ComponentProps } from "react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RequestError } from "@/components/feedback/session-recovery"
import { erpFetch } from "@/lib/api/client"
import type { Schema } from "@/lib/api/types"
import { normalizeDecimal } from "@/lib/decimal-input"
import { quantity, useCommand, useResource } from "@/hooks/use-operation"
import { ColorChoice, Lookup, type Choice } from "./orders"
import "./proposals-print.css"

type Detail = Schema<"ProposalSnapshot">
type Listing = Schema<"ProposalList">
type Selected = Choice & { quantity: string; structureColor: string; upholsteryColor: string }
const labels: Record<string, string> = { draft: "Rascunho", sent: "Enviada", accepted: "Aceita", rejected: "Rejeitada", cancelled: "Cancelada", expired: "Expirada", superseded: "Substituída" }
const linkClass = "font-medium text-primary underline underline-offset-4"
const textareaClass = "min-h-24 w-full rounded-lg border border-input bg-background p-3"
const money = (value: string) => `R$ ${value.replace(".", ",")}`

function CommercialText({ label, ...props }: ComponentProps<"textarea"> & { label: string }) {
  const id = useId()
  return <div className="grid gap-2"><label htmlFor={id}>{label}</label><textarea id={id} className={textareaClass} {...props} /></div>
}

export function Proposals({ id, create = false, edit = false }: { id?: string; create?: boolean; edit?: boolean }) {
  if (create || edit) return <ProposalEditor id={edit ? id : undefined} />
  if (id) return <ProposalDetail key={id} id={id} />
  return <ProposalList />
}

function ProposalList() {
  const [query, setQuery] = useState({ q: "", status: "", offset: 0 })
  const params = new URLSearchParams({ q: query.q, status: query.status, offset: String(query.offset), limit: "25" })
  const result = useResource<Listing>(`/api/erp/proposals?${params}`)
  return <><PageHeader eyebrow="Vendas" title="Propostas comerciais" description="Orçamentos, condições e versões comerciais da empresa ativa." />
    <section className="form-section min-w-0 space-y-5">
      {result.value?.canEdit && <Link className={linkClass} href="/vendas/propostas/novo">Nova proposta</Link>}
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); setQuery({ q: String(data.get("q") || ""), status: String(data.get("status") || ""), offset: 0 }) }}>
        <label className="min-w-0 flex-1 space-y-2">Cliente ou número<Input name="q" maxLength={160} /></label>
        <label className="grid gap-2">Situação<select name="status" className="min-h-10 rounded-lg border bg-background px-3"><option value="">Todas</option>{Object.entries(labels).filter(([key]) => key !== "superseded").map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <Button type="submit">Pesquisar propostas</Button>
      </form>
      {result.loading ? <p role="status">Carregando propostas…</p> : result.error ? <div role="alert"><RequestError message={result.error} status={result.status} /><Button variant="outline" onClick={result.reload}>Tentar novamente</Button></div> : <>
        <p>{result.value?.total || 0} proposta(s)</p>
        {!result.value?.data.length && <p>Nenhuma proposta encontrada para estes filtros.</p>}
        <ul className="grid min-w-0 gap-3 sm:grid-cols-2">{result.value?.data.map(item => <li className="min-w-0 space-y-2 rounded-xl border p-4" key={item.id}>
          <Link className={linkClass} href={`/vendas/propostas/${item.id}`}>Proposta {item.number} · {item.customerName}</Link>
          <p>{labels[item.expired ? "expired" : item.status]} · versão {item.version}</p><p>{money(item.amount)} · validade {item.validUntil}</p>
        </li>)}</ul>
        <div className="flex justify-between gap-3"><Button variant="outline" disabled={!query.offset} onClick={() => setQuery(value => ({ ...value, offset: value.offset - 25 }))}>Anterior</Button><Button variant="outline" disabled={query.offset + 25 >= (result.value?.total || 0)} onClick={() => setQuery(value => ({ ...value, offset: value.offset + 25 }))}>Próxima</Button></div>
      </>}
    </section>
  </>
}

function ProposalEditor({ id }: { id?: string }) {
  const result = useResource<Listing | Detail>(id ? `/api/erp/proposals/${id}` : "/api/erp/proposals?limit=1")
  if (result.loading) return <p role="status">Carregando proposta e permissões…</p>
  if (result.error || !result.value) return <section className="form-section"><p role="alert"><RequestError message={result.error || "Proposta indisponível"} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button></section>
  const initial = "items" in result.value ? result.value : undefined
  if (!result.value.canEdit || (initial && initial.data.status !== "draft")) return <section className="form-section space-y-4"><p>Esta proposta não está disponível para edição. É necessário um rascunho e permissão de gestão.</p><Link className={linkClass} href={id ? `/vendas/propostas/${id}` : "/vendas/propostas"}>Voltar às propostas</Link></section>
  return <ProposalForm key={`${id || "new"}:${result.etag}`} initial={initial} tenantId={result.value.tenantId} etag={result.etag} reload={result.reload} />
}

function ProposalForm({ initial, tenantId, etag, reload }: { initial?: Detail; tenantId: string; etag: string; reload: () => void }) {
  const router = useRouter()
  const command = useCommand()
  const access = useResource<{ tenant: { id: string; legalName: string }; permissions: string[] }>("/api/erp/me")
  const canNegotiate = access.value?.tenant.id === tenantId && access.value.permissions.includes("sales.proposals.negotiate")
  const [customer, setCustomer] = useState<Choice | null>(initial ? { id: initial.data.customerId, legalName: initial.data.customerName } : null)
  const [items, setItems] = useState<Selected[]>(() => initial?.items.map(item => ({ id: item.productId, name: item.name, sku: item.sku, unit: item.unit, basePrice: item.unitPrice, quantity: item.quantity, structureColor: item.structureColor || "", upholsteryColor: item.upholsteryColor || "" })) || [])
  const [validUntil, setValidUntil] = useState(initial?.data.validUntil || "")
  const [paymentTerms, setPaymentTerms] = useState(initial?.data.paymentTerms || "")
  const [deliveryTerms, setDeliveryTerms] = useState(initial?.data.deliveryTerms || "")
  const [notes, setNotes] = useState(initial?.data.notes || "")
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState("")
  const frozen = command.busy || command.uncertain || command.stale
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty || command.uncertain) event.preventDefault() }
    window.addEventListener("beforeunload", prevent)
    return () => window.removeEventListener("beforeunload", prevent)
  }, [dirty, command.uncertain])
  useEffect(() => {
    if (!initial) return
    const controller = new AbortController()
    Promise.all(initial.items.map(async item => {
      const response = await erpFetch(`/api/erp/products/${item.productId}`, { cache: "no-store", signal: controller.signal })
      const product = await response.json()
      if (!response.ok || product.tenantId !== tenantId) throw new Error("Não foi possível atualizar as opções de acabamento. As escolhas registradas foram preservadas.")
      return { id: item.productId, structureColors: product.data.structureColors || [], upholsteryColors: product.data.upholsteryColors || [] }
    })).then(products => { if (!controller.signal.aborted) setItems(previous => previous.map(item => ({ ...item, ...products.find(product => product.id === item.id) }))) })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Falha ao consultar produtos") })
    return () => controller.abort()
  }, [initial, tenantId])
  function changeItem(id: string, patch: Partial<Selected>) { setItems(previous => previous.map(item => item.id === id ? { ...item, ...patch } : item)); setDirty(true) }
  return <><PageHeader eyebrow="Vendas / Propostas" title={initial ? `Editar proposta ${initial.data.number} · versão ${initial.data.version}` : "Nova proposta"} description="Defina o escopo e as condições comerciais. O rascunho fica salvo na empresa ativa." />
    <section className="form-section min-w-0 space-y-5">
      <Link className={linkClass} href={initial ? `/vendas/propostas/${initial.data.id}` : "/vendas/propostas"} onClick={event => { if ((dirty || command.uncertain) && !window.confirm("Sair sem confirmar as alterações desta proposta?")) event.preventDefault() }}>Voltar às propostas</Link>
      <div className="grid gap-4 lg:grid-cols-2"><Lookup endpoint="parties" label="cliente" disabled={frozen} choose={value => { setCustomer(value); setDirty(true) }} /><Lookup endpoint="products" label="produto" disabled={frozen || items.length >= 100} choose={value => {
        if (items.some(item => item.id === value.id)) { setError("Produto já incluído. Altere a quantidade do item existente."); return }
        const saved = initial?.items.find(item => item.productId === value.id)
        setItems(previous => [...previous, { ...value, ...(saved ? { name: saved.name, sku: saved.sku, basePrice: saved.unitPrice } : {}), quantity: "1", structureColor: saved?.structureColor || "", upholsteryColor: saved?.upholsteryColor || "" }]); setDirty(true); setError("")
      }} /></div>
      <p>Cliente selecionado: {customer?.legalName || "Nenhum"}</p>
      <form className="space-y-5" onSubmit={async event => {
        event.preventDefault(); setError("")
        if (!customer || !items.length || items.some(item => !quantity(item.quantity) || !normalizeDecimal(item.basePrice || "", 2))) { setError("Selecione cliente e itens com quantidades e preços válidos."); return }
        const value = await command.send<Detail>(initial ? `/api/erp/proposals/${initial.data.id}` : "/api/erp/proposals", tenantId, { customerId: customer.id, validUntil, paymentTerms, deliveryTerms, notes, items: items.map(item => ({ productId: item.id, quantity: quantity(item.quantity), unitPrice: normalizeDecimal(item.basePrice || "", 2), structureColor: item.structureColor || null, upholsteryColor: item.upholsteryColor || null })) }, initial ? etag : "", initial ? "PUT" : "POST")
        if (value) { setDirty(false); router.replace(`/vendas/propostas/${value.data.id}`) }
      }}>
        <fieldset disabled={frozen} className="min-w-0 space-y-4" onChange={() => setDirty(true)}>
          <label className="grid gap-2">Validade da proposta<Input type="date" required value={validUntil} onChange={event => setValidUntil(event.target.value)} /></label>
          <CommercialText label="Condições de pagamento" required maxLength={2000} value={paymentTerms} onChange={event => setPaymentTerms(event.target.value)} />
          <CommercialText label="Condições de entrega" required maxLength={2000} value={deliveryTerms} onChange={event => setDeliveryTerms(event.target.value)} />
          <CommercialText label="Observações" maxLength={10000} value={notes} onChange={event => setNotes(event.target.value)} />
          {items.map(item => <section className="min-w-0 space-y-3 rounded-xl border p-4" key={item.id} aria-label={`Item da proposta: ${item.name}`}>
            <h2 className="break-words font-medium">{item.name} · {item.sku}</h2>
            <label className="grid gap-2">Preço unitário de {item.name}<Input inputMode="decimal" required readOnly={!canNegotiate} value={item.basePrice || ""} onChange={event => changeItem(item.id, { basePrice: event.target.value })} /></label>
            {!canNegotiate && <p className="text-sm text-muted-foreground">Alterar preços exige permissão de negociação comercial.</p>}
            <label className="grid gap-2">Quantidade de {item.name}<Input inputMode="decimal" required value={item.quantity} onChange={event => changeItem(item.id, { quantity: event.target.value })} /></label>
            <div className="grid gap-3 sm:grid-cols-2"><ColorChoice label={`Estrutura de ${item.name}`} options={item.structureColors} value={item.structureColor} onChange={value => changeItem(item.id, { structureColor: value })} /><ColorChoice label={`Estofado de ${item.name}`} options={item.upholsteryColors} value={item.upholsteryColor} onChange={value => changeItem(item.id, { upholsteryColor: value })} /></div>
            <Button type="button" variant="outline" onClick={() => { setItems(previous => previous.filter(value => value.id !== item.id)); setDirty(true) }}>Remover {item.name}</Button>
          </section>)}
        </fieldset>
        {(error || command.error) && <p role="alert"><RequestError message={error || command.error} status={error ? undefined : command.status} /></p>}
        {command.stale && <Button type="button" variant="outline" onClick={() => { if (window.confirm("Recarregar e descartar as alterações locais?")) { command.reset(); reload() } }}>Recarregar proposta</Button>}
        {command.uncertain && <p role="status">Resultado pendente. Repita a confirmação para conferir o mesmo comando.</p>}
        <Button type="submit" disabled={command.busy || command.stale || !customer || !items.length}>{command.busy ? "Confirmando…" : command.uncertain ? "Repetir confirmação" : "Salvar proposta"}</Button>
      </form>
    </section>
  </>
}

function ProposalDetail({ id }: { id: string }) {
  const [version, setVersion] = useState("")
  const result = useResource<Detail>(`/api/erp/proposals/${id}${version ? `?version=${version}` : ""}`)
  const access = useResource<{ tenant: { id: string; legalName: string }; permissions: string[] }>("/api/erp/me")
  const command = useCommand()
  const [action, setAction] = useState("")
  const [reason, setReason] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [notice, setNotice] = useState("")
  const value = result.value
  const frozen = command.busy || command.uncertain || command.stale
  const sameTenant = access.value?.tenant.id === value?.tenantId
  const canDecide = sameTenant && access.value?.permissions.includes("sales.proposals.decide")
  const canConvert = sameTenant && ["sales.orders.read", "sales.orders.manage"].every(permission => access.value?.permissions.includes(permission))
  async function confirm() {
    if (!value || !action) return
    const body = action === "convert" ? { dueDate } : action === "revise" ? {} : { reason: reason || null }
    const updated = await command.send<Detail>(`/api/erp/proposals/${id}/${action}`, value.tenantId, body, result.etag)
    if (updated) { setNotice("Operação confirmada no servidor."); setAction(""); setReason(""); setVersion(""); result.reload() }
  }
  return <><div className="print:hidden"><PageHeader eyebrow="Vendas / Propostas" title={value ? `Proposta ${value.data.number}` : "Proposta comercial"} description="Consulte o documento comercial e registre as decisões sobre cada versão." /></div>
    <div className="print:hidden"><Link className={linkClass} href="/vendas/propostas">Voltar às propostas</Link></div>
    <section data-proposal-document className="form-section mt-5 min-w-0 space-y-5">
      {notice && <p role="status" className="print:hidden">{notice}</p>}
      {result.loading ? <p role="status">Carregando proposta…</p> : result.error ? <div role="alert"><RequestError message={result.error} status={result.status} /><Button onClick={result.reload}>Tentar novamente</Button></div> : value && <>
        {sameTenant && <p className="font-semibold">{access.value?.tenant.legalName}</p>}
        <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="font-semibold">{value.data.customerName}</h2><p>{value.data.customerTaxId}</p><p>Proposta {value.data.number} · versão {value.data.version} · {labels[value.data.expired ? "expired" : value.data.status]}</p></div><Button className="print:hidden" variant="outline" onClick={() => window.print()}>Imprimir / salvar PDF</Button></div>
        <label className="grid gap-2 print:hidden">Histórico de versões<select className="min-h-10 rounded-lg border bg-background px-3" value={version} disabled={frozen} onChange={event => { setVersion(event.target.value); setAction("") }}><option value="">Versão atual</option>{value.versions.map(item => <option key={item.version} value={String(item.version)}>Versão {item.version} · {labels[item.status]} · {money(item.amount)}</option>)}</select></label>
        <p>Validade: {value.data.validUntil}</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Itens da proposta</caption><thead><tr><th className="p-2">Produto</th><th className="p-2">Quantidade</th><th className="p-2">Unitário</th><th className="p-2">Total</th></tr></thead><tbody>{value.items.map(item => <tr key={item.productId} className="border-t"><td className="p-2">{item.name}<span className="block text-xs">{item.sku}{item.structureColor && ` · Estrutura: ${item.structureColor}`}{item.upholsteryColor && ` · Estofado: ${item.upholsteryColor}`}</span></td><td className="p-2">{item.quantity} {item.unit}</td><td className="whitespace-nowrap p-2">{money(item.unitPrice)}</td><td className="whitespace-nowrap p-2">{money(item.amount)}</td></tr>)}</tbody></table></div>
        <p className="text-xl font-semibold">Total: {money(value.data.amount)}</p>
        <section><h3 className="font-medium">Pagamento</h3><p className="whitespace-pre-wrap break-words">{value.data.paymentTerms}</p></section>
        <section><h3 className="font-medium">Entrega</h3><p className="whitespace-pre-wrap break-words">{value.data.deliveryTerms}</p></section>
        {value.data.notes && <section><h3 className="font-medium">Observações</h3><p className="whitespace-pre-wrap break-words">{value.data.notes}</p></section>}
        {value.data.decisionReason && <p className="whitespace-pre-wrap">Motivo registrado: {value.data.decisionReason}</p>}
        {value.data.orderId && <Link className={`${linkClass} print:hidden`} href={`/vendas/pedidos/${value.data.orderId}`}>Consultar pedido gerado</Link>}
        {!value.data.isCurrent && <p>Versão histórica. Consulte a versão atual para realizar operações.</p>}
        <div className="space-y-4 print:hidden">
          {command.error && <p role="alert"><RequestError message={command.error} status={command.status} /></p>}
          {command.stale && <Button variant="outline" onClick={() => { command.reset(); setAction(""); result.reload() }}>Recarregar proposta</Button>}
          {value.data.isCurrent && !value.data.orderId && !action && <div className="flex flex-wrap gap-3">
            {value.canEdit && value.data.status === "draft" && <><Link className={linkClass} href={`/vendas/propostas/${id}/editar`}>Editar rascunho</Link><Button disabled={frozen} onClick={() => setAction("send")}>Marcar como enviada</Button></>}
            {canDecide && value.data.status === "sent" && <><Button disabled={frozen || value.data.expired} onClick={() => setAction("accept")}>Registrar aceite</Button><Button disabled={frozen} variant="outline" onClick={() => setAction("reject")}>Registrar rejeição</Button></>}
            {value.canEdit && ["sent", "accepted", "rejected"].includes(value.data.status) && <Button disabled={frozen} variant="outline" onClick={() => setAction("revise")}>Criar nova versão</Button>}
            {value.canEdit && ["draft", "sent", "accepted"].includes(value.data.status) && <Button disabled={frozen} variant="outline" onClick={() => setAction("cancel")}>Cancelar proposta</Button>}
            {value.canEdit && canConvert && value.data.status === "accepted" && <Button disabled={frozen} onClick={() => setAction("convert")}>Gerar pedido em rascunho</Button>}
          </div>}
          {action && <form className="space-y-3 rounded-xl border p-4" onSubmit={event => { event.preventDefault(); void confirm() }}>
            <p>{action === "send" ? "Confirme que esta versão já foi enviada ao cliente. O conteúdo ficará bloqueado; este botão não envia mensagens." : action === "accept" ? "Registre o aceite recebido do cliente. Este registro interno não equivale a uma assinatura digital." : action === "revise" ? "Uma nova versão em rascunho será criada, preservando o conteúdo anterior." : action === "convert" ? "Será criado um pedido em rascunho com os preços acordados. A reserva e a cobrança seguem o fluxo do pedido." : "Informe o motivo desta decisão."}</p>
            {["reject", "cancel"].includes(action) && <CommercialText label="Motivo" required maxLength={2000} disabled={frozen} value={reason} onChange={event => setReason(event.target.value)} />}
            {action === "convert" && <label className="grid gap-2">Vencimento do pedido<Input type="date" required disabled={frozen} value={dueDate} onChange={event => setDueDate(event.target.value)} /></label>}
            <div className="flex gap-3"><Button type="submit" disabled={command.busy || command.stale}>{command.uncertain ? "Repetir confirmação" : "Confirmar operação"}</Button><Button type="button" variant="outline" disabled={frozen} onClick={() => setAction("")}>Voltar</Button></div>
          </form>}
        </div>
      </>}
    </section>
  </>
}
