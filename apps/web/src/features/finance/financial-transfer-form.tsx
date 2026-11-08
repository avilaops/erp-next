"use client"

import { useState } from "react"
import { RequestError } from "@/components/feedback/session-recovery"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { decimalPattern, normalizeDecimal } from "@/lib/decimal-input"
import { useCommand } from "@/hooks/use-operation"

type Account = { id: string; code: string; name: string; status: string }

export function FinancialTransferForm({ tenantId, accounts, onSaved }: { tenantId: string; accounts: Account[]; onSaved: () => void }) {
  const command = useCommand()
  const [sourceAccountId, setSourceAccountId] = useState(accounts[0]?.id || "")
  const [targetAccountId, setTargetAccountId] = useState(accounts[1]?.id || "")
  const [amount, setAmount] = useState("")
  const [occurredOn, setOccurredOn] = useState("")
  const [description, setDescription] = useState("")
  const [reference, setReference] = useState("")
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = normalizeDecimal(amount)
    if (!normalized || !sourceAccountId || !targetAccountId || sourceAccountId === targetAccountId) return
    const result = await command.send("/api/erp/financial-account-transfers", tenantId, { sourceAccountId, targetAccountId, amount: normalized, occurredOn, description, reference: reference || null })
    if (result) { setAmount(""); setOccurredOn(""); setDescription(""); setReference(""); command.reset(); onSaved() }
  }
  const frozen = command.busy || command.uncertain || command.stale
  return <form className="space-y-4 rounded-2xl border p-5" onSubmit={submit}>
    <h2 className="font-semibold">Transferência entre contas</h2>
    <p className="text-sm text-muted-foreground">A operação cria uma saída e uma entrada na mesma transação. Não movimenta dinheiro em banco.</p>
    <fieldset disabled={frozen} className="grid gap-4 sm:grid-cols-2">
      <label className="grid gap-2 text-sm">Conta de origem<select className="h-9 rounded-lg border bg-background px-3" value={sourceAccountId} onChange={event => setSourceAccountId(event.target.value)}>{accounts.map(account => <option value={account.id} key={account.id}>{account.code} · {account.name}</option>)}</select></label>
      <label className="grid gap-2 text-sm">Conta de destino<select className="h-9 rounded-lg border bg-background px-3" value={targetAccountId} onChange={event => setTargetAccountId(event.target.value)}>{accounts.map(account => <option value={account.id} key={account.id}>{account.code} · {account.name}</option>)}</select></label>
      <label className="grid gap-2 text-sm">Valor<Input required inputMode="decimal" pattern={decimalPattern(2)} maxLength={15} value={amount} onChange={event => setAmount(event.target.value)} placeholder="0,00" /></label>
      <label className="grid gap-2 text-sm">Data<Input required type="date" value={occurredOn} onChange={event => setOccurredOn(event.target.value)} /></label>
      <label className="grid gap-2 text-sm">Descrição<Input required minLength={3} maxLength={200} value={description} onChange={event => setDescription(event.target.value)} /></label>
      <label className="grid gap-2 text-sm">Referência (opcional)<Input maxLength={200} value={reference} onChange={event => setReference(event.target.value)} /></label>
    </fieldset>
    {command.error && <p role="alert"><RequestError message={command.error} status={command.status} /></p>}
    {command.uncertain && <p role="status">Confirmação pendente. Repita o mesmo comando para conferir o resultado.</p>}
    <Button type="submit" disabled={frozen || accounts.length < 2}>{command.busy ? "Confirmando…" : command.uncertain ? "Repetir confirmação" : "Transferir entre contas"}</Button>
  </form>
}
