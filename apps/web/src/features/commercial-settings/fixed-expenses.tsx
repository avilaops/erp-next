"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/page-header"
import { RequestError } from "@/components/feedback/session-recovery"
import { useCommand, useResource } from "@/hooks/use-operation"

type Expense = { id: string; description: string; categoryId: string; categoryName: string; amountCents: number; startsOn: string; endsOn: string | null; status: "active" | "archived"; revision: number }
type Listing = { tenantId: string; data: Expense[]; monthlyExpensesCents: number }
type Category = { id: string; name: string; direction: string; status: string }
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

export function FixedExpenses() {
  const expenses = useResource<Listing>("/api/erp/fixed-expenses")
  const categories = useResource<{ tenantId: string; data: Category[] }>("/api/erp/financial-categories?limit=100")
  const [selected, setSelected] = useState<Expense | null>(null)
  const [serial, setSerial] = useState(0)
  const available = categories.value?.tenantId === expenses.value?.tenantId ? categories.value.data.filter(row => row.direction === "expense" && row.status === "active") : []
  return <main className="mx-auto max-w-5xl space-y-5 px-4 pb-24 pt-6">
    <PageHeader eyebrow="Preferências / Comercial" title="Despesas fixas" description="Despesas mensais recorrentes usadas na formação da tabela de preços." />
    <Link className="text-primary underline" href="/preferencias/comercial">Voltar aos parâmetros</Link>
    {expenses.loading || categories.loading ? <p role="status">Carregando despesas e categorias…</p> : expenses.error ? <p role="alert"><RequestError message={expenses.error} status={expenses.status} /></p> : categories.error ? <p role="alert"><RequestError message={categories.error} status={categories.status} /></p> : expenses.value && <>
      <p>Total mensal vigente: <strong>{money(expenses.value.monthlyExpensesCents)}</strong></p>
      <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => { setSelected(null); setSerial(v => v + 1) }}>Nova despesa</Button><Button type="button" variant="outline" onClick={() => { expenses.reload(); categories.reload() }}>Recarregar</Button></div>
      <ul className="space-y-2">{expenses.value.data.map(row => <li className="form-section flex flex-wrap items-center justify-between gap-2" key={row.id}><span>{row.description} · {row.categoryName} · {money(row.amountCents)} · {row.status === "active" ? "Ativa" : "Arquivada"}</span><Button type="button" variant="outline" onClick={() => { setSelected(row); setSerial(v => v + 1) }}>Editar</Button></li>)}</ul>
      <ExpenseForm key={`${selected?.id || "new"}:${serial}`} tenant={expenses.value.tenantId} initial={selected} categories={available} saved={() => { expenses.reload(); setSelected(null); setSerial(v => v + 1) }} />
    </>}
  </main>
}

function ExpenseForm({ tenant, initial, categories, saved }: { tenant: string; initial: Expense | null; categories: Category[]; saved: () => void }) {
  const command = useCommand()
  const [description, setDescription] = useState(initial?.description || "")
  const [categoryId, setCategoryId] = useState(initial?.categoryId || "")
  const [amount, setAmount] = useState(initial ? (initial.amountCents / 100).toFixed(2).replace(".", ",") : "")
  const [startsOn, setStartsOn] = useState(initial?.startsOn || "")
  const [endsOn, setEndsOn] = useState(initial?.endsOn || "")
  const [status, setStatus] = useState<"active" | "archived">(initial?.status || "active")
  const [error, setError] = useState("")
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("")
    const normalized = amount.trim().replace(",", ".")
    if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(normalized)) { setError("Informe o valor em reais com até duas casas decimais."); return }
    const [whole, fraction = ""] = normalized.split(".")
    const amountCents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
    const result = await command.send<{ tenantId: string; data: Expense }>(initial ? `/api/erp/fixed-expenses/${initial.id}` : "/api/erp/fixed-expenses", tenant,
      { description, categoryId, amountCents, startsOn, endsOn: endsOn || null, status }, initial ? `"${initial.revision}"` : "", initial ? "PUT" : "POST")
    if (result?.tenantId === tenant) saved()
  }
  return <form className="form-section space-y-3" onSubmit={submit}>
    <h2 className="font-semibold">{initial ? "Editar despesa" : "Nova despesa"}</h2>
    {!categories.length && <p role="status">Cadastre uma <Link className="text-primary underline" href="/cadastros/categorias-financeiras">categoria financeira de despesa</Link> para continuar.</p>}
    <fieldset disabled={command.busy || command.uncertain || command.stale} className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1">Descrição<Input required minLength={3} maxLength={200} value={description} onChange={e => setDescription(e.target.value)} /></label>
      <label className="grid gap-1">Categoria de despesa<select required className="min-h-10 rounded-lg border bg-background px-2" value={categoryId} onChange={e => setCategoryId(e.target.value)}><option value="">Selecione</option>{categories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label className="grid gap-1">Valor mensal (R$)<Input required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label className="grid gap-1">Início<Input required type="date" value={startsOn} onChange={e => setStartsOn(e.target.value)} /></label>
      <label className="grid gap-1">Término (opcional)<Input type="date" value={endsOn} onChange={e => setEndsOn(e.target.value)} /></label>
      <label className="grid gap-1">Situação<select className="min-h-10 rounded-lg border bg-background px-2" value={status} onChange={e => setStatus(e.target.value as "active" | "archived")}><option value="active">Ativa</option><option value="archived">Arquivada</option></select></label>
    </fieldset>
    {(error || command.error) && <p role="alert">{error || command.error}</p>}
    {command.uncertain && <p>Confirmação incerta. Repita o mesmo comando.</p>}
    {command.stale && <p>Outra pessoa alterou este cadastro. Recarregue as despesas.</p>}
    <Button type="submit" disabled={command.busy || command.stale || !categories.length}>{command.uncertain ? "Repetir confirmação" : "Salvar despesa"}</Button>
  </form>
}
