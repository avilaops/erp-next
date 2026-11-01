"use client"

import { decimalPattern } from "@/lib/decimal-input"

import { RequestError } from "@/components/feedback/session-recovery"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { quantity, useCommand, useResource } from "@/hooks/use-operation"
import { PurchaseLookup, type PurchaseChoice } from "./purchase-lookup"
import { fixedText, fixedValue, money, purchaseLink, type PurchaseDetail, type PurchaseList } from "./purchase-types"

type DraftLine = PurchaseChoice & { quantity: string; unitCost: string }

export function PurchaseEditor({ id }: { id?: string }) {
  const result = useResource<PurchaseDetail | PurchaseList>(id ? `/api/erp/purchase-orders/${id}` : "/api/erp/purchase-orders?limit=1")
  if (result.loading) return <><PageHeader eyebrow="Compras" title={id ? "Editar pedido de compra" : "Novo pedido de compra"} description="Consulte os dados e as permissões antes de editar a compra." /><p role="status">Carregando compra e permissões…</p></>
  if (result.error || !result.value) return <><PageHeader eyebrow="Compras" title={id ? "Editar pedido de compra" : "Novo pedido de compra"} description="Consulte os dados e as permissões antes de editar a compra." /><Link className={purchaseLink} href="/compras/pedidos">Voltar à lista</Link><section className="form-section space-y-3"><p role="alert"><RequestError message={result.error || "Compra indisponível"} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button></section></>
  const initial = "items" in result.value ? result.value : undefined
  if (!result.value.canEdit || initial && initial.data.status !== "draft") return <section className="form-section space-y-3"><PageHeader eyebrow="Compras" title="Pedido de compra" description="A edição exige permissão de gestão e um pedido em rascunho." /><p role="status">{!result.value.canEdit ? "Somente consulta. Solicite permissão para alterar compras." : "Este pedido não está em rascunho."}</p><Link className={purchaseLink} href={id ? `/compras/pedidos/${id}` : "/compras/pedidos"}>Voltar às compras</Link></section>
  return <PurchaseForm key={`${id || "new"}:${result.etag}`} initial={initial} tenantId={result.value.tenantId} etag={result.etag} reload={result.reload} />
}

function PurchaseForm({ initial, tenantId, etag, reload }: { initial?: PurchaseDetail; tenantId: string; etag: string; reload: () => void }) {
  const router = useRouter()
  const command = useCommand()
  const [supplier, setSupplier] = useState<PurchaseChoice | null>(initial ? { id: initial.data.supplierId, legalName: initial.data.supplierName } : null)
  const [items, setItems] = useState<DraftLine[]>(() => initial?.items.map(item => ({ id: item.productId, name: item.name, sku: item.sku, unit: item.unit, quantity: item.quantity, unitCost: item.unitCost })) || [])
  const [dueDate, setDueDate] = useState(initial?.data.dueDate || "")
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState("")
  const frozen = command.busy || command.uncertain || command.stale
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty || command.uncertain) event.preventDefault() }
    window.addEventListener("beforeunload", prevent)
    return () => window.removeEventListener("beforeunload", prevent)
  }, [dirty, command.uncertain])
  let total = BigInt(0)
  let complete = items.length > 0
  for (const item of items) {
    const count = fixedValue(item.quantity, 6), cost = fixedValue(item.unitCost, 2)
    if (count === null || count <= BigInt(0) || cost === null) { complete = false; continue }
    total += (count * cost + BigInt(500000)) / BigInt(1000000)
  }
  function change(id: string, field: "quantity" | "unitCost", value: string) {
    setItems(previous => previous.map(item => item.id === id ? { ...item, [field]: value } : item)); setDirty(true)
  }
  return <>
    <PageHeader eyebrow="Compras" title={initial ? "Editar pedido de compra" : "Novo pedido de compra"} description="Informe o fornecedor, as quantidades e os custos negociados. Salvar o rascunho não envia um pedido ao fornecedor nem movimenta estoque." />
    <Link className={purchaseLink} href={initial ? `/compras/pedidos/${initial.data.id}` : "/compras/pedidos"} onClick={event => { if ((dirty || command.uncertain) && !window.confirm("Sair sem confirmar as alterações desta compra?")) event.preventDefault() }}>Voltar às compras</Link>
    <section className="form-section mt-5 min-w-0 space-y-5">
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <PurchaseLookup supplier disabled={frozen} choose={value => { setSupplier(value); setDirty(true) }} />
        <PurchaseLookup disabled={frozen || items.length >= 100} choose={value => {
          if (items.some(item => item.id === value.id)) { setError("Produto já incluído. Altere a quantidade no item existente."); return }
          const saved = initial?.items.find(item => item.productId === value.id)
          setItems(previous => [...previous, { ...value, quantity: saved?.quantity || "1", unitCost: saved?.unitCost || "" }]); setDirty(true); setError("")
        }} />
      </div>
      <form className="space-y-5" onSubmit={async event => {
        event.preventDefault(); setError("")
        if (!supplier || !complete || total <= BigInt(0)) { setError("Selecione um fornecedor, produtos com quantidades positivas e custos válidos. O total deve ser positivo."); return }
        const body = { supplierId: supplier.id, dueDate, items: items.map(item => ({ productId: item.id, quantity: quantity(item.quantity)!, unitCost: fixedText(fixedValue(item.unitCost, 2)!, 2) })) }
        const value = await command.send<PurchaseDetail>(`/api/erp/purchase-orders${initial ? `/${initial.data.id}` : ""}`, tenantId, body, initial ? etag : "", initial ? "PUT" : "POST")
        if (value) { setDirty(false); router.replace(`/compras/pedidos/${value.data.id}`) }
      }}>
        <fieldset disabled={frozen} className="min-w-0 space-y-4">
          <p className="break-words"><strong>Fornecedor:</strong> {supplier?.legalName || "Selecione um fornecedor acima"}</p>
          <label className="block min-w-0 space-y-2">Vencimento da compra<Input required type="date" value={dueDate} onChange={event => { setDueDate(event.target.value); setDirty(true) }} /></label>
          {!items.length && <p>Selecione os produtos acima para montar a compra.</p>}
          {items.map(item => <section className="min-w-0 space-y-3 rounded-xl border p-4" key={item.id} aria-label={`Item ${item.name}`}>
            <h2 className="break-words font-semibold">{item.name}</h2><p className="break-words text-sm">SKU {item.sku} · Unidade {item.unit}</p>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <label className="min-w-0 space-y-2">Quantidade de {item.name}<Input required inputMode="decimal" maxLength={19} pattern={decimalPattern(6)} value={item.quantity} onChange={event => change(item.id, "quantity", event.target.value)} /></label>
              <label className="min-w-0 space-y-2">Custo unitário de {item.name}<Input required inputMode="decimal" placeholder="0,00" maxLength={15} pattern={decimalPattern(2)} value={item.unitCost} onChange={event => change(item.id, "unitCost", event.target.value)} /></label>
            </div>
            <Button className="h-auto max-w-full whitespace-normal break-words" type="button" variant="outline" onClick={() => { setItems(previous => previous.filter(value => value.id !== item.id)); setDirty(true) }}>Remover {item.name}</Button>
          </section>)}
        </fieldset>
        <p className="text-sm text-muted-foreground">Use vírgula ou ponto nos decimais, sem separador de milhar. Os custos da compra são informados por você; o preço de venda não é usado como custo.</p>
        {complete && <p className="font-medium">Total previsto: {money(fixedText(total, 2))}</p>}
        {(error || command.error) && <p role="alert"><RequestError message={error || command.error} status={error ? undefined : command.status} /></p>}
        {command.uncertain && <p role="status">Confirmação pendente. Conferir usa o mesmo comando, preservando os dados enviados.</p>}
        {command.stale && <Button type="button" variant="outline" onClick={() => { if (window.confirm("Descartar sua edição e recarregar a compra atual?")) { command.reset(); reload() } }}>Recarregar compra</Button>}
        <Button className="h-auto max-w-full whitespace-normal" type="submit" disabled={command.busy || command.stale || !supplier || !items.length}>{command.busy ? "Confirmando…" : command.uncertain ? "Conferir gravação da compra" : initial ? "Salvar rascunho" : "Criar rascunho de compra"}</Button>
      </form>
    </section>
  </>
}
