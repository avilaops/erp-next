"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { GuardedLink as Link } from "@/components/shell/navigation-guard"
import { DataTable } from "@/components/workspace/data-table"
import { CurrencyCell, CurrencyValue, EmptyState, FilterField, ResponsiveTable, SearchToolbar, SortableTableHeader, StatusBadge } from "@/components/workspace/list-layout"
import { useTableSort } from "@/components/workspace/use-table-sort"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCommand, useResource } from "@/hooks/use-operation"
import { CashNav, controlClass, Failure, SaleReceipt } from "./pos-shared"
import { money, when, type CashSession, type Envelope, type Listing, type Sale } from "./pos-model"

export function CashHistory() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const selected = searchParams.get("caixa")
  const table = useTableSort(["register", "openedAt", "status", "closedAt"], { by: "openedAt", order: "desc" }, "sessions")
  const rawOffset = Number(searchParams.get("offset") || 0)
  const query = { status: searchParams.get("status") || "", register: searchParams.get("register") || "", startDate: searchParams.get("startDate") || "", endDate: searchParams.get("endDate") || "", offset: Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0 }
  function setQuery(values: Partial<typeof query>) {
    const next = new URLSearchParams(window.location.search)
    for (const [key, value] of Object.entries(values)) { if (value !== "" && value !== 0) next.set(key, String(value)); else next.delete(key) }
    router.push(`${window.location.pathname}${next.size ? `?${next}` : ""}${window.location.hash}`, { scroll: false })
  }
  const params = new URLSearchParams(table.query)
  params.set("offset", String(query.offset)); params.set("limit", "20")
  for (const key of ["status", "register", "startDate", "endDate"] as const) if (query[key]) params.set(key, query[key])
  const history = useResource<Listing<CashSession>>(`/api/erp/pos/sessions?${params}`)
  return <div className="space-y-5"><CashNav /><SearchToolbar key={`${query.register}:${query.status}:${query.startDate}:${query.endDate}`} pending={history.loading} canClear={!!(query.register || query.status || query.startDate || query.endDate)} onClear={() => setQuery({ status: "", register: "", startDate: "", endDate: "", offset: 0 })} onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); setQuery({ status: String(data.get("status") || ""), register: String(data.get("register") || "").trim(), startDate: String(data.get("startDate") || ""), endDate: String(data.get("endDate") || ""), offset: 0 }) }}>
    <FilterField label="Caixa do histórico"><Input name="register" maxLength={80} defaultValue={query.register} /></FilterField><FilterField label="Situação"><select name="status" className={controlClass} defaultValue={query.status}><option value="">Todas</option><option value="open">Aberto</option><option value="closed">Fechado</option></select></FilterField><FilterField label="Abertura de"><Input type="date" name="startDate" defaultValue={query.startDate} /></FilterField><FilterField label="Abertura até"><Input type="date" name="endDate" defaultValue={query.endDate} /></FilterField>
  </SearchToolbar>{history.loading ? <p role="status">Consultando histórico…</p> : history.error || !history.value ? <Failure message={history.error || "Histórico indisponível"} status={history.status} retry={history.reload} /> : <>
    <p role="status" className="text-xs text-muted-foreground">{history.value.total} caixa(s)</p>
    <ResponsiveTable label="Histórico dos caixas"><DataTable aria-label="Histórico dos caixas" className="min-w-[640px]"><thead><tr>{[["register", "Caixa"], ["openedAt", "Abertura"], ["status", "Situação"], ["closedAt", "Fechamento"]].map(([field, label]) => <SortableTableHeader field={field} sort={table.sort} onSort={table.toggle} key={field}>{label}</SortableTableHeader>)}<th scope="col"><span className="sr-only">Consultar</span></th></tr></thead><tbody>{history.value.data.map(session => <tr key={session.id}><td><span className="font-medium">{session.register}</span><span className="block text-xs text-muted-foreground">Saldo inicial: <CurrencyValue>{money(session.openingAmount)}</CurrencyValue></span></td><td className="text-xs">{when(session.openedAt)}</td><td><StatusBadge tone={session.status === "closed" ? "neutral" : "success"}>{session.status === "closed" ? "Fechado" : "Aberto"}</StatusBadge></td><td className="text-xs">{when(session.closedAt)}</td><td><Link className="text-sm text-primary underline" href={`/vendas/pdv/fechamento?caixa=${session.id}`}>Conferir</Link></td></tr>)}{!history.value.data.length && <tr><td colSpan={5}><EmptyState filtered={!!(query.register || query.status || query.startDate || query.endDate)} description="Nenhum caixa encontrado neste período." /></td></tr>}</tbody></DataTable></ResponsiveTable>
    <nav aria-label="Paginação do histórico" className="flex items-center justify-between gap-3"><Button variant="outline" disabled={!query.offset} onClick={() => setQuery({ offset: Math.max(0, query.offset - 20) })}>Anterior</Button><span className="text-xs">Página {Math.floor(query.offset / 20) + 1}</span><Button variant="outline" disabled={query.offset + 20 >= history.value.total} onClick={() => setQuery({ offset: query.offset + 20 })}>Próxima</Button></nav>
    {selected && <SessionSales id={selected} tenant={history.value.tenantId} onChanged={history.reload} />}
  </>}</div>
}

export function SessionSales({ id, tenant, onChanged }: { id: string; tenant: string; onChanged: () => void }) {
  const params = useSearchParams()
  const router = useRouter()
  const table = useTableSort(["createdAt", "status", "total"], { by: "createdAt", order: "desc" }, "sales")
  const rawOffset = Number(params.get("salesOffset") || 0)
  const offset = Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0
  function setOffset(value: number) {
    const next = new URLSearchParams(window.location.search)
    if (value) next.set("salesOffset", String(value)); else next.delete("salesOffset")
    router.push(`${window.location.pathname}${next.size ? `?${next}` : ""}${window.location.hash}`, { scroll: false })
  }
  const [selected, setSelected] = useState("")
  const salesParams = new URLSearchParams(table.query)
  salesParams.set("sessionId", id); salesParams.set("offset", String(offset)); salesParams.set("limit", "20")
  const sales = useResource<Listing<Sale>>(`/api/erp/pos/sales?${salesParams}`)
  return <section className="space-y-3"><h2 className="font-semibold">Vendas do caixa</h2>{sales.loading ? <p role="status">Consultando vendas…</p> : sales.error || sales.value?.tenantId !== tenant ? <Failure message={sales.error || "Vendas indisponíveis"} retry={sales.reload} /> : <>
    <ResponsiveTable label="Vendas do caixa"><DataTable aria-label="Vendas do caixa"><thead><tr>{[["createdAt", "Data"], ["status", "Situação"], ["total", "Total"]].map(([field, label]) => <SortableTableHeader field={field} sort={table.sort} onSort={table.toggle} key={field}>{label}</SortableTableHeader>)}<th scope="col"><span className="sr-only">Comprovante</span></th></tr></thead><tbody>{sales.value?.data.map(sale => <tr key={sale.id}><td className="text-xs">{when(sale.createdAt)}</td><td><StatusBadge tone={sale.status === "cancelled" ? "warning" : "success"}>{sale.status === "cancelled" ? "Cancelada" : "Concluída"}</StatusBadge></td><CurrencyCell>{money(sale.total)}</CurrencyCell><td><Button size="sm" variant="ghost" onClick={() => setSelected(sale.id)}>Comprovante</Button></td></tr>)}{!sales.value?.data.length && <tr><td colSpan={4}><EmptyState filtered={false} title="Nenhuma venda registrada" description="As vendas deste caixa aparecerão aqui." /></td></tr>}</tbody></DataTable></ResponsiveTable>
    <div className="flex justify-between gap-3"><Button size="sm" variant="outline" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 20))}>Vendas anteriores</Button><Button size="sm" variant="outline" disabled={offset + 20 >= (sales.value?.total || 0)} onClick={() => setOffset(offset + 20)}>Próximas vendas</Button></div>
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
