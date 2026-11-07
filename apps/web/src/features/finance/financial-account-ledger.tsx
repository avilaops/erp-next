"use client"

import { useState } from "react"
import { PageHeader } from "@/components/page-header"
import { RequestError } from "@/components/feedback/session-recovery"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { decimalPattern, normalizeDecimal } from "@/lib/decimal-input"
import { useCommand, useResource } from "@/hooks/use-operation"
import { FinancialTransferForm } from "./financial-transfer-form"

type Account = { id: string; code: string; name: string; status: string; accountType: string }
type Accounts = { tenantId: string; data: Account[]; total: number }
type Entry = { id: string; accountId: string; categoryName: string | null; direction: "credit" | "debit"; amount: string; occurredOn: string; description: string; reference: string | null }
type Ledger = { tenantId: string; canEdit: boolean; data: { account: Account; credit: string; debit: string; balance: string; entries: Entry[]; total: number; offset: number; limit: number } }

const money = (value: string) => `R$ ${value.replace(".", ",")}`

export function FinancialAccountLedger() {
  const accounts = useResource<Accounts>("/api/erp/financial-accounts?status=active&limit=100")
  const [selected, setSelected] = useState("")
  const accountId = selected || accounts.value?.data[0]?.id || ""
  const ledger = useResource<Ledger>(accountId ? `/api/erp/financial-account-entries?accountId=${encodeURIComponent(accountId)}&limit=50` : "")
  const command = useCommand()
  const [direction, setDirection] = useState<"credit" | "debit">("credit")
  const [amount, setAmount] = useState("")
  const [occurredOn, setOccurredOn] = useState("")
  const [description, setDescription] = useState("")
  const [reference, setReference] = useState("")
  const value = ledger.value?.data
  const frozen = command.busy || command.uncertain || command.stale

  function clear() {
    setAmount("")
    setOccurredOn("")
    setDescription("")
    setReference("")
  }

  async function createEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = normalizeDecimal(amount)
    if (!normalized || !accountId) return
    const result = await command.send("/api/erp/financial-account-entries", accounts.value?.tenantId || "", { accountId, direction, amount: normalized, occurredOn, description, reference: reference || null })
    if (result) {
      clear()
      ledger.reload()
    }
  }

  return <main className="mx-auto w-full max-w-6xl space-y-6 px-4 pb-24 pt-8 lg:px-6">
    <PageHeader eyebrow="Financeiro / Caixa e bancos" title="Caixas e bancos" description="Lançamentos manuais append-only por conta financeira. O saldo é calculado no servidor e não representa conciliação bancária automática." />
    {accounts.loading ? <p role="status">Carregando contas financeiras…</p> : accounts.error ? <section className="rounded-xl border p-4" role="alert"><RequestError message={accounts.error} status={accounts.status} /><Button variant="outline" onClick={accounts.reload}>Tentar novamente</Button></section> : !accounts.value?.data.length ? <section className="rounded-xl border p-5"><p>Nenhuma conta financeira ativa. Cadastre uma conta antes de lançar movimentos.</p></section> : <>
      <label className="grid max-w-xl gap-2 text-sm">Conta financeira<select className="h-10 rounded-lg border bg-background px-3" value={accountId} onChange={event => { setSelected(event.target.value); command.reset() }}>{accounts.value.data.map(account => <option value={account.id} key={account.id}>{account.code} · {account.name}</option>)}</select></label>
      {ledger.loading ? <p role="status">Carregando saldo e lançamentos…</p> : ledger.error ? <section className="rounded-xl border p-4" role="alert"><RequestError message={ledger.error} status={ledger.status} /><Button variant="outline" onClick={ledger.reload}>Tentar novamente</Button></section> : value && <>
        <section className="grid gap-3 sm:grid-cols-3" aria-label="Saldo da conta"><div className="rounded-xl border p-4"><p className="text-sm text-muted-foreground">Saldo calculado</p><p className="mt-2 text-2xl font-semibold">{money(value.balance)}</p></div><div className="rounded-xl border p-4"><p className="text-sm text-muted-foreground">Entradas</p><p className="mt-2 text-xl font-semibold">{money(value.credit)}</p></div><div className="rounded-xl border p-4"><p className="text-sm text-muted-foreground">Saídas</p><p className="mt-2 text-xl font-semibold">{money(value.debit)}</p></div></section>
        {ledger.value?.canEdit && <form className="space-y-4 rounded-2xl border p-5" onSubmit={createEntry}><h2 className="font-semibold">Novo lançamento</h2><p className="text-sm text-muted-foreground">Para corrigir um lançamento, registre outro movimento de ajuste. O histórico não é apagado nem alterado.</p><fieldset disabled={frozen} className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm">Tipo<select className="h-9 rounded-lg border bg-background px-3" value={direction} onChange={event => setDirection(event.target.value as typeof direction)}><option value="credit">Entrada</option><option value="debit">Saída</option></select></label><label className="grid gap-2 text-sm">Valor<Input required inputMode="decimal" pattern={decimalPattern(2)} maxLength={15} value={amount} onChange={event => setAmount(event.target.value)} placeholder="0,00" /></label><label className="grid gap-2 text-sm">Data<Input required type="date" value={occurredOn} onChange={event => setOccurredOn(event.target.value)} /></label><label className="grid gap-2 text-sm">Descrição<Input required minLength={3} maxLength={200} value={description} onChange={event => setDescription(event.target.value)} /></label><label className="grid gap-2 text-sm sm:col-span-2">Referência (opcional)<Input maxLength={200} value={reference} onChange={event => setReference(event.target.value)} /></label></fieldset>{command.error && <p role="alert"><RequestError message={command.error} status={command.status} /></p>}{command.uncertain && <p role="status">Confirmação pendente. Repita para consultar o mesmo comando.</p>}<Button type="submit" disabled={frozen}>{command.busy ? "Confirmando…" : command.uncertain ? "Repetir confirmação" : "Registrar lançamento"}</Button></form>}
        {ledger.value?.canEdit && accounts.value?.tenantId && <FinancialTransferForm tenantId={accounts.value.tenantId} accounts={accounts.value.data} onSaved={ledger.reload} />}
        <section className="space-y-4 rounded-2xl border p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Histórico da conta</h2><span className="text-sm text-muted-foreground">{value.total} lançamento(s)</span></div>{!value.entries.length ? <p className="text-sm text-muted-foreground">Nenhum lançamento registrado nesta conta.</p> : <ul className="space-y-3">{value.entries.map(entry => <li className="flex flex-wrap justify-between gap-3 rounded-xl border p-4" key={entry.id}><div><p className="font-medium">{entry.direction === "credit" ? "Entrada" : "Saída"} · {entry.description}</p><p className="text-sm text-muted-foreground">{entry.occurredOn}{entry.categoryName ? ` · ${entry.categoryName}` : ""}{entry.reference ? ` · ${entry.reference}` : ""}</p></div><strong className={entry.direction === "credit" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>{entry.direction === "credit" ? "+" : "-"}{money(entry.amount)}</strong></li>)}</ul>}</section>
      </>}
    </>}
  </main>
}
