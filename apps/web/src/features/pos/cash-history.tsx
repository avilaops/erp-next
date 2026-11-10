"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { DataTable } from "@/components/workspace/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCommand, useResource } from "@/hooks/use-operation"
import { CashNav, controlClass, Failure, SaleReceipt } from "./pos-shared"
import { money, when, type CashSession, type Envelope, type Listing, type Sale } from "./pos-model"

export function CashHistory() {
  const selected = useSearchParams().get("caixa")
  const [query, setQuery] = useState({ status: "", register: "", startDate: "", endDate: "", offset: 0 })
  const params = new URLSearchParams({ offset: String(query.offset), limit: "20" })
  for (const key of ["status", "register", "startDate", "endDate"] as const) if (query[key]) params.set(key, query[key])
  const history = useResource<Listing<CashSession>>(`/api/erp/pos/sessions?${params}`)
  return <div className="space-y-5"><CashNav /><form className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); setQuery({ status: String(data.get("status") || ""), register: String(data.get("register") || ""), startDate: String(data.get("startDate") || ""), endDate: String(data.get("endDate") || ""), offset: 0 }) }}>
    <label className="grid gap-1.5 text-xs font-medium">Caixa do histórico<Input name="register" maxLength={80} /></label><label className="grid gap-1.5 text-xs font-medium">Situação<select name="status" className={controlClass}><option value="">Todas</option><option value="open">Aberto</option><option value="closed">Fechado</option></select></label><label className="grid gap-1.5 text-xs font-medium">Abertura de<Input type="date" name="startDate" /></label><label className="grid gap-1.5 text-xs font-medium">Abertura até<Input type="date" name="endDate" /></label><Button type="submit">Pesquisar caixas</Button>
  </form>{history.loading ? <p role="status">Consultando histórico…</p> : history.error || !history.value ? <Failure message={history.error || "Histórico indisponível"} status={history.status} retry={history.reload} /> : <>
    <p role="status" className="text-xs text-muted-foreground">{history.value.total} caixa(s)</p>
    <div className="max-w-full overflow-x-auto rounded-lg border"><DataTable aria-label="Histórico dos caixas"><thead><tr><th>Caixa</th><th>Abertura</th><th>Situação</th><th className="hidden sm:table-cell">Fechamento</th><th><span className="sr-only">Consultar</span></th></tr></thead><tbody>{history.value.data.map(session => <tr key={session.id}><td><span className="font-medium">{session.register}</span><span className="block text-xs text-muted-foreground">Saldo inicial: {money(session.openingAmount)}</span></td><td className="text-xs">{when(session.openedAt)}</td><td>{session.status === "closed" ? "Fechado" : "Aberto"}</td><td className="hidden text-xs sm:table-cell">{when(session.closedAt)}</td><td><Link className="text-sm text-primary underline" href={`/vendas/pdv/fechamento?caixa=${session.id}`}>Conferir</Link></td></tr>)}</tbody></DataTable></div>
    {!history.value.data.length && <p>Nenhum caixa encontrado neste período.</p>}
    <nav aria-label="Paginação do histórico" className="flex items-center justify-between gap-3"><Button variant="outline" disabled={!query.offset} onClick={() => setQuery(value => ({ ...value, offset: Math.max(0, value.offset - 20) }))}>Anterior</Button><span className="text-xs">Página {Math.floor(query.offset / 20) + 1}</span><Button variant="outline" disabled={query.offset + 20 >= history.value.total} onClick={() => setQuery(value => ({ ...value, offset: value.offset + 20 }))}>Próxima</Button></nav>
    {selected && <SessionSales id={selected} tenant={history.value.tenantId} onChanged={history.reload} />}
  </>}</div>
}

export function SessionSales({ id, tenant, onChanged }: { id: string; tenant: string; onChanged: () => void }) {
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState("")
  const sales = useResource<Listing<Sale>>(`/api/erp/pos/sales?sessionId=${encodeURIComponent(id)}&offset=${offset}&limit=20`)
  return <section className="space-y-3"><h2 className="font-semibold">Vendas do caixa</h2>{sales.loading ? <p role="status">Consultando vendas…</p> : sales.error || sales.value?.tenantId !== tenant ? <Failure message={sales.error || "Vendas indisponíveis"} retry={sales.reload} /> : <>
    <div className="overflow-x-auto rounded-lg border"><DataTable aria-label="Vendas do caixa"><thead><tr><th>Data</th><th>Situação</th><th className="text-right">Total</th><th><span className="sr-only">Comprovante</span></th></tr></thead><tbody>{sales.value?.data.map(sale => <tr key={sale.id}><td className="text-xs">{when(sale.createdAt)}</td><td>{sale.status === "cancelled" ? "Cancelada" : "Concluída"}</td><td className="whitespace-nowrap text-right">{money(sale.total)}</td><td><Button size="sm" variant="ghost" onClick={() => setSelected(sale.id)}>Comprovante</Button></td></tr>)}</tbody></DataTable></div>
    {!sales.value?.data.length && <p className="text-sm text-muted-foreground">Nenhuma venda registrada neste caixa.</p>}
    <div className="flex justify-between gap-3"><Button size="sm" variant="outline" disabled={!offset} onClick={() => setOffset(value => Math.max(0, value - 20))}>Vendas anteriores</Button><Button size="sm" variant="outline" disabled={offset + 20 >= (sales.value?.total || 0)} onClick={() => setOffset(value => value + 20)}>Próximas vendas</Button></div>
  </>}{selected && <SavedSale id={selected} tenant={tenant} onClose={() => setSelected("")} onChanged={() => { sales.reload(); onChanged() }} />}</section>
}

function SavedSale({ id, tenant, onClose, onChanged }: { id: string; tenant: string; onClose: () => void; onChanged: () => void }) {
  const sale = useResource<Envelope<Sale> & { session: CashSession }>(`/api/erp/pos/sales/${id}`)
  const rights = useResource<{ permissions: string[] }>("/api/erp/me")
  const [reason, setReason] = useState("")
  const command = useCommand()
  const value = sale.value?.tenantId === tenant ? sale.value : null
  const canCancel = rights.value?.permissions.includes("sales.pos.cancel") && value?.data.status === "completed" && value?.session.status === "open"
  if (sale.loading) return <p role="status">Consultando comprovante…</p>
  if (sale.error || !value) return <Failure message={sale.error || "Comprovante indisponível"} retry={sale.reload} />
  return <div className="space-y-3"><SaleReceipt sale={value.data} register={value.session.register} onClose={onClose} />{canCancel && <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Cancelar e estornar venda</summary><form className="mt-3 space-y-3" onSubmit={async e => { e.preventDefault(); if (!command.uncertain && !window.confirm("Cancelar esta venda e estornar estoque e recebimentos?")) return; const result = await command.send<Envelope<Sale>>(`/api/erp/pos/sales/${id}/cancel`, tenant, { reason: reason.trim() }, `"${value.session.revision}"`); if (result?.tenantId === tenant) { sale.reload(); onChanged() } }}><label className="grid gap-1.5 text-xs font-medium">Motivo do cancelamento<Input required minLength={3} maxLength={1000} disabled={command.busy || command.uncertain || command.stale} value={reason} onChange={e => setReason(e.target.value)} /></label><p className="text-xs text-muted-foreground">O estorno registra a devolução integral dos valores nas contas de recebimento e recompõe o estoque.</p>{command.error && <Failure message={command.error} status={command.status} retry={command.stale ? () => { command.reset(); sale.reload() } : undefined} />}<Button type="submit" variant="destructive" disabled={command.busy || command.stale}>{command.uncertain ? "Conferir estorno" : "Confirmar cancelamento e estorno"}</Button></form></details>}</div>
}
