"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/workspace/data-table"
import { CurrencyCell, EmptyState, ResponsiveTable, SortableTableHeader, StatusBadge } from "@/components/workspace/list-layout"
import { Pagination } from "@/components/workspace/pagination"
import { useTableSort } from "@/components/workspace/use-table-sort"
import { useCommand, useResource } from "@/hooks/use-operation"
import { AccountSelect, CashNav, Failure, SessionSummary } from "./pos-shared"
import { amount, cents, money, when, type Account, type CashSession, type Envelope, type Listing, type Movement } from "./pos-model"
import { SessionSales } from "./cash-history"

export function CashClosing() {
  const id = useSearchParams().get("caixa")
  const resource = useResource<Envelope<CashSession | null>>(id ? `/api/erp/pos/sessions/${encodeURIComponent(id)}` : "/api/erp/pos/sessions/current?register=Principal")
  return <div className="space-y-5"><CashNav id={resource.value?.data?.id} />{resource.loading ? <p role="status">Consultando fechamento…</p> : resource.error || !resource.value ? <Failure message={resource.error || "Caixa indisponível"} status={resource.status} retry={resource.reload} /> : resource.value.data ? <ClosingEditor key={`${resource.value.tenantId}:${resource.value.data.id}:${resource.value.data.revision}`} snapshot={resource.value as Envelope<CashSession>} reload={resource.reload} /> : <p>Não há caixa aberto. Consulte o histórico para conferir fechamentos anteriores.</p>}</div>
}

function ClosingEditor({ snapshot, reload }: { snapshot: Envelope<CashSession>; reload: () => void }) {
  const [closed, setClosed] = useState<CashSession | null>(null)
  const session = closed || snapshot.data
  const params = useSearchParams()
  const router = useRouter()
  const table = useTableSort(["createdAt", "type", "amount"], { by: "createdAt", order: "desc" }, "movements")
  const rawOffset = Number(params.get("movementsOffset") || 0)
  const offset = Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0
  const movementParams = new URLSearchParams(table.query)
  movementParams.set("offset", String(offset)); movementParams.set("limit", "50")
  const movements = useResource<Listing<Movement>>(`/api/erp/pos/sessions/${encodeURIComponent(session.id)}/movements?${movementParams}`)
  function movementOffset(nextOffset: number) {
    const next = new URLSearchParams(window.location.search)
    if (nextOffset) next.set("movementsOffset", String(nextOffset)); else next.delete("movementsOffset")
    router.push(`${window.location.pathname}${next.size ? `?${next}` : ""}${window.location.hash}`, { scroll: false })
  }
  const [counted, setCounted] = useState("")
  const [reason, setReason] = useState("")
  const rights = useResource<{ permissions: string[] }>("/api/erp/me")
  const command = useCommand()
  const canClose = snapshot.canClose ?? rights.value?.permissions.includes("sales.pos.close") ?? false
  const countedCents = cents(counted)
  const difference = countedCents == null ? null : countedCents - (cents(session.totals.expectedCash) || 0)
  const frozen = command.busy || command.uncertain || command.stale
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3"><div><h2 className="font-semibold">Caixa {session.register}</h2><p className="mt-1 text-xs text-muted-foreground">Aberto em {when(session.openedAt)}{session.closedAt && ` · Fechado em ${when(session.closedAt)}`}</p></div><span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{session.status === "closed" ? "Caixa fechado" : "Caixa aberto"}</span></div>
    <SessionSummary session={session} />
    {session.status === "open" && <>
      {snapshot.canEdit && <CashMovement session={session} tenant={snapshot.tenantId} reload={() => { reload(); movements.reload() }} />}
      <form className="max-w-xl space-y-4 rounded-lg border bg-muted/20 p-4" onSubmit={async e => { e.preventDefault(); const value = amount(counted); if (!value || difference !== 0 && reason.trim().length < 3) return; const result = await command.send<Envelope<CashSession>>(`/api/erp/pos/sessions/${session.id}/close`, snapshot.tenantId, { countedCash: value, reason: reason.trim() || null }, `"${session.revision}"`); if (result?.tenantId === snapshot.tenantId && result.data.id === session.id) { setClosed(result.data) } }}>
        <h2 className="font-semibold">Conferência do dinheiro</h2><fieldset disabled={frozen || !canClose} className="space-y-3"><label className="grid gap-1.5 text-xs font-medium">Dinheiro contado (R$)<Input required inputMode="decimal" value={counted} onChange={e => setCounted(e.target.value)} /></label><p role="status" className="text-sm">Diferença: <strong>{money(difference)}</strong></p><label className="grid gap-1.5 text-xs font-medium">Justificativa da diferença<Input required={difference !== null && difference !== 0} minLength={difference !== null && difference !== 0 ? 3 : undefined} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} placeholder="Obrigatória quando houver diferença" /></label></fieldset>
        <p className="text-xs text-muted-foreground">O fechamento registra o dinheiro contado e a diferença para conferência. Nenhum ajuste de saldo é criado automaticamente.</p>
        {!canClose && <p role="status" className="text-sm">A conclusão exige permissão para fechar o PDV.</p>}
        {command.error && <Failure message={command.error} status={command.status} retry={command.stale ? reload : undefined} />}
        <Button type="submit" disabled={!canClose || command.busy || command.stale}>{command.busy ? "Fechando…" : command.uncertain ? "Conferir fechamento" : "Confirmar fechamento"}</Button>
      </form>
    </>}
    <section className="space-y-3"><h2 className="font-semibold">Movimentações do caixa</h2>{movements.loading ? <p role="status">Consultando movimentações…</p> : movements.error || movements.value?.tenantId !== snapshot.tenantId ? <Failure message={movements.error || "Movimentações indisponíveis"} retry={movements.reload} /> : <>
      <p role="status" className="text-xs text-muted-foreground">{movements.value.total} movimentação(ões)</p>
      <ResponsiveTable label="Movimentações do caixa"><DataTable aria-label="Movimentações do caixa"><thead><tr>{[["createdAt", "Data"], ["type", "Tipo e motivo"], ["amount", "Valor"]].map(([field, label]) => <SortableTableHeader field={field} sort={table.sort} onSort={table.toggle} key={field}>{label}</SortableTableHeader>)}</tr></thead><tbody>{movements.value.data.map(movement => <tr key={movement.id}><td className="whitespace-nowrap">{when(movement.createdAt)}</td><td><StatusBadge tone={movement.direction === "supply" ? "success" : "warning"}>{movement.direction === "supply" ? "Suprimento" : "Sangria"}</StatusBadge><span className="block text-xs text-muted-foreground">{movement.reason}</span></td><CurrencyCell>{money(movement.amount)}</CurrencyCell></tr>)}{!movements.value.data.length && <tr><td colSpan={3}><EmptyState filtered={false} title="Nenhuma movimentação registrada" description="Suprimentos e sangrias deste caixa aparecerão aqui." /></td></tr>}</tbody></DataTable></ResponsiveTable>
      <Pagination offset={offset} pageSize={50} total={movements.value.total} loading={movements.loading} onOffsetChange={movementOffset} />
    </>}</section>
    <SessionSales id={session.id} tenant={snapshot.tenantId} onChanged={reload} />
  </div>
}

function CashMovement({ session, tenant, reload }: { session: CashSession; tenant: string; reload: () => void }) {
  const accounts = useResource<Listing<Account>>("/api/erp/financial-accounts?status=active&limit=100")
  const [direction, setDirection] = useState("supply")
  const [value, setValue] = useState("")
  const [accountId, setAccountId] = useState("")
  const [reason, setReason] = useState("")
  const command = useCommand()
  const frozen = command.busy || command.uncertain || command.stale
  return <details className="max-w-xl rounded-lg border p-4"><summary className="cursor-pointer text-sm font-semibold">Suprimento ou sangria</summary><form className="mt-4 space-y-3" onSubmit={async e => { e.preventDefault(); const normalized = amount(value); if (!normalized || Number(normalized) <= 0 || accounts.value?.tenantId !== tenant) return; const result = await command.send<Envelope<CashSession>>(`/api/erp/pos/sessions/${session.id}/movements`, tenant, { direction, amount: normalized, reason: reason.trim(), ...(direction === "supply" ? { sourceAccountId: accountId } : { targetAccountId: accountId }) }, `"${session.revision}"`); if (result?.tenantId === tenant && result.data.id === session.id) reload() }}>
    <fieldset disabled={frozen} className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-xs font-medium">Movimentação<select className="h-9 rounded-lg border bg-background px-3 text-sm" value={direction} onChange={e => setDirection(e.target.value)}><option value="supply">Suprimento · entrada no caixa</option><option value="withdrawal">Sangria · retirada do caixa</option></select></label><label className="grid gap-1.5 text-xs font-medium">Valor da movimentação (R$)<Input required inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} /></label><div className="sm:col-span-2"><AccountSelect label={direction === "supply" ? "Conta de origem do suprimento" : "Conta de destino da sangria"} accounts={accounts.value?.tenantId === tenant ? accounts.value.data : []} omit={session.cashAccountId} value={accountId} onChange={setAccountId} /></div><label className="grid gap-1.5 text-xs font-medium sm:col-span-2">Motivo da movimentação<Input required minLength={3} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label></fieldset>
    <p className="text-xs text-muted-foreground">A movimentação transfere saldo entre as contas financeiras selecionadas.</p>
    {(accounts.error || command.error) && <Failure message={accounts.error || command.error} status={command.status} retry={command.stale ? reload : undefined} />}
    <Button type="submit" disabled={command.busy || command.stale || !accountId}>{command.busy ? "Registrando…" : command.uncertain ? "Conferir movimentação" : "Registrar movimentação"}</Button>
  </form></details>
}
