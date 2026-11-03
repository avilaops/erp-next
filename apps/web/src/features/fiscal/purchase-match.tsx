"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useCommand, useResource } from "@/hooks/use-operation"
import { erpFetch } from "@/lib/api/client"
import { PurchaseLookup, type PurchaseChoice } from "@/features/purchasing/purchase-lookup"

export type FiscalPurchaseItem = { number: number; sourceCode: string; name: string; unit: string; ncm?: string; quantityMicros: number; landedCents: number }
type Purchase = { id: string; supplierName: string; amount: string; status: string; revision: number }
type Preview = {
  purchaseRevision: number; canConfirm: boolean; invoiceTotalCents: number
  differences: { code: string; itemNumber: number | null; blocking: boolean; message: string }[]
  items: { itemNumber: number; name: string; unit: string; ncm: string; invoiceQuantityMicros: number; remainingQuantityMicros: number; invoiceUnitCostCents: number; purchaseUnitCostCents: number | null; landedCents: number; components: Record<string, number> }[]
}
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
const quantity = (value: number) => (value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 6 })

export function PurchaseMatch({ noteId, tenantId, items, onLinked, onBack }: { noteId: number; tenantId: string; items: FiscalPurchaseItem[]; onLinked: (id: string) => void; onBack: () => void }) {
  const [offset, setOffset] = useState(0)
  const purchases = useResource<{ data: Purchase[]; total: number }>(`/api/erp/purchase-orders?limit=10&offset=${offset}`)
  const command = useCommand()
  const [selected, setSelected] = useState<Purchase | null>(null)
  const [mapping, setMapping] = useState<Record<number, PurchaseChoice>>({})
  const [activeItem, setActiveItem] = useState(items[0]?.number || 1)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState("")
  const frozen = checking || command.busy || command.uncertain || command.stale
  const complete = selected && items.length > 0 && items.every(item => mapping[item.number])
  const body = () => ({ purchaseOrderId: selected!.id, purchaseRevision: preview?.purchaseRevision || selected!.revision, items: items.map(item => ({ itemNumber: item.number, productId: mapping[item.number].id })) })

  async function check() {
    if (!complete || frozen) return
    setChecking(true); setError(""); setPreview(null)
    try {
      const response = await erpFetch(`/api/erp/fiscal/received-nfes/${noteId}/purchase/preview`, { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId }, body: JSON.stringify(body()) })
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Não foi possível conferir a compra")
      setPreview(value)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Prévia indisponível") }
    finally { setChecking(false) }
  }

  async function link() {
    if (!complete || !preview?.canConfirm) return
    const result = await command.send<{ purchaseOrderId: string }>(`/api/erp/fiscal/received-nfes/${noteId}/purchase/match`, tenantId, body(), '"1"')
    if (result) onLinked(result.purchaseOrderId)
  }

  return <div className="min-w-0 space-y-4">
    <Button variant="outline" disabled={frozen} onClick={onBack}>Voltar à criação de compra</Button>
    <h3 className="text-lg font-semibold">Conciliar com compra existente</h3>
    <p className="text-sm text-muted-foreground">Selecione uma compra confirmada e sem recebimentos anteriores. Cada compra aceita uma NF-e. A confirmação cria o vínculo documental; o recebimento físico, o estoque e a conta a pagar continuam no fluxo de compras.</p>
    {purchases.loading ? <p role="status">Consultando compras…</p> : purchases.error ? <div role="alert"><p>{purchases.error}</p><Button variant="outline" onClick={purchases.reload}>Recarregar compras</Button></div> : <>
      <ul className="space-y-2">{purchases.value?.data.filter(purchase => purchase.status === "confirmed").map(purchase => <li key={purchase.id}><Button variant="outline" className="h-auto max-w-full whitespace-normal break-words text-left" disabled={frozen} onClick={() => { setSelected(purchase); setPreview(null); setError("") }}>Selecionar compra de {purchase.supplierName} · {money.format(Number(purchase.amount))}</Button></li>)}</ul>
      {!purchases.value?.data.some(purchase => purchase.status === "confirmed") && <p>Nenhuma compra confirmada nesta página.</p>}
      <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={frozen || offset === 0} onClick={() => { setOffset(value => Math.max(0, value - 10)) }}>Compras anteriores</Button><Button variant="outline" disabled={frozen || offset + 10 >= (purchases.value?.total || 0)} onClick={() => setOffset(value => value + 10)}>Próximas compras</Button></div>
    </>}
    <p className="break-words text-sm"><strong>Compra selecionada:</strong> {selected ? `${selected.supplierName} · ${money.format(Number(selected.amount))}` : "Nenhuma"}</p>
    <div className="space-y-3">{items.map(item => <article className="min-w-0 rounded-xl border p-4 text-sm" key={item.number}><h4 className="break-words font-medium">Item {item.number}: {item.name}</h4><p>{quantity(item.quantityMicros)} {item.unit} · NCM {item.ncm || "não informado"} · {money.format(item.landedCents / 100)}</p><p className="break-words">Produto vinculado: {mapping[item.number]?.name || "Selecione um produto do catálogo"}</p></article>)}</div>
    <label className="block space-y-2 text-sm">Item fiscal para conciliar<select className="block w-full min-w-0 rounded-xl border bg-background p-3" disabled={frozen} value={activeItem} onChange={event => setActiveItem(Number(event.target.value))}>{items.map(item => <option key={item.number} value={item.number}>Item {item.number}: {item.name}</option>)}</select></label>
    <PurchaseLookup disabled={frozen} choose={product => {
      if (Object.entries(mapping).some(([number,value]) => Number(number) !== activeItem && value.id === product.id)) { setError("Este produto já está vinculado a outro item da nota."); return }
      setMapping(previous => ({ ...previous, [activeItem]: product })); setPreview(null); setError("")
    }} />
    <Button disabled={!complete || frozen} onClick={() => void check()}>{checking ? "Conferindo…" : "Conferir divergências"}</Button>
    {preview && <section aria-label="Prévia da conciliação" className="space-y-3 rounded-xl border p-4 text-sm">
      <p className="font-medium">Total da nota: {money.format(preview.invoiceTotalCents / 100)}</p>
      {preview.items.map(item => <div className="min-w-0 space-y-1 border-t pt-3" key={item.itemNumber}><p className="break-words font-medium">Item {item.itemNumber}: {item.name}</p><p>Nota: {quantity(item.invoiceQuantityMicros)} {item.unit} · Pendente na compra: {quantity(item.remainingQuantityMicros)} {item.unit}</p><p>Custo unitário da nota: {money.format(item.invoiceUnitCostCents / 100)} · Compra: {item.purchaseUnitCostCents === null ? "não encontrado" : money.format(item.purchaseUnitCostCents / 100)}</p><details><summary className="cursor-pointer">Composição do custo posto</summary><dl className="mt-2 grid grid-cols-2 gap-2">{Object.entries(item.components).map(([name,value]) => <div key={name}><dt>{name}</dt><dd>{money.format(value / 100)}</dd></div>)}</dl><p className="mt-2 text-muted-foreground">Valores declarados no XML. Nenhum crédito tributário será deduzido automaticamente.</p></details></div>)}
      {preview.differences.map((difference,index) => <p key={`${difference.code}-${index}`} role={difference.blocking ? "alert" : undefined}>{difference.message}</p>)}
      {!preview.differences.length && <p>Sem divergências identificadas no mapeamento.</p>}
      <Button disabled={!preview.canConfirm || command.busy || command.stale} onClick={() => void link()}>{command.busy ? "Vinculando…" : command.uncertain ? "Conferir vínculo enviado" : "Confirmar vínculo documental"}</Button>
    </section>}
    {(error || command.error) && <p role="alert" className="text-sm text-destructive">{error || command.error}</p>}
    {command.uncertain && <p role="status" className="text-sm">Resultado ainda não confirmado. A compra e os produtos foram preservados; conferir o vínculo usa o mesmo comando.</p>}
    {command.stale && <Button variant="outline" onClick={() => { command.reset(); setPreview(null); setSelected(null); purchases.reload() }}>Recarregar compra e conferir novamente</Button>}
  </div>
}
