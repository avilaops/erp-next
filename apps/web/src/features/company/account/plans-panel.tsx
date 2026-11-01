"use client"

import { useState } from "react"
import { ArrowRight, Check, Gem } from "lucide-react"
import { Button } from "@/components/ui/button"
import { money, type Account, type Plan, type Subscription } from "./account-types"
import { Notice } from "./account-panels"

export function PlansPanel({ account, subscription, busy, submit }: { account: Account; subscription?: Subscription; busy: boolean; submit: (action: string, body: object) => Promise<boolean> }) {
  const [selected, setSelected] = useState<Plan | null>(null)
  const [email, setEmail] = useState("")
  const existing = subscription && !["cancelled", "rejected"].includes(subscription.status)
  const changing = existing && subscription.status === "authorized"
  return <div className="space-y-6">
    <p className="text-sm leading-relaxed text-muted-foreground">Compare os planos mensais e escolha a capacidade para sua empresa. A autorização e as cobranças recorrentes são realizadas pelo Mercado Pago.</p>
    <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">{account.plans.map(plan => {
      const current = subscription?.planId === plan.id && existing
      return <article key={plan.id} className={`flex flex-col rounded-2xl border p-5 ${current ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
        <div className="flex items-start justify-between gap-2"><h3 className="text-lg font-semibold">{plan.name}</h3>{current ? <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">Plano vinculado</span> : <Gem className="size-5 shrink-0 text-muted-foreground" />}</div>
        <p className="mb-5 mt-5">{plan.customQuote && <span className="block text-xs text-muted-foreground">A partir de</span>}<strong className="text-2xl font-semibold tracking-tight">{money(plan.monthlyCents)}</strong><span className="ml-1 text-xs text-muted-foreground">/mês</span></p>
        <ul className="mb-6 space-y-3 text-sm">{[`${plan.dataMegabytes.toLocaleString("pt-BR")} MB de dados`, plan.users ? `Até ${plan.users} usuários` : "Usuários ilimitados", plan.importedOrders ? `${plan.importedOrders} importações de pedidos / mês` : "Franquia de importações a definir"].map(item => <li className="flex items-start gap-2" key={item}><Check className="mt-0.5 size-4 shrink-0 text-primary" />{item}</li>)}</ul>
        <Button className="mt-auto min-h-11" variant={current ? "outline" : "default"} disabled={busy || !account.canEdit || !account.providerConfigured || Boolean(current) || Boolean(existing && !changing) || plan.customQuote} onClick={() => setSelected(plan)}>{current ? "Plano vinculado" : plan.customQuote ? "Proposta comercial necessária" : changing ? "Alterar para este plano" : "Escolher plano"}{!current && !plan.customQuote && <ArrowRight />}</Button>
      </article>
    })}</div>
    {existing && !changing && <Notice>A assinatura atual precisa ser autorizada, atualizada ou cancelada antes de iniciar outra contratação.</Notice>}
    {selected && <form aria-label="Confirmar plano" className="space-y-5 rounded-xl border border-primary/40 bg-primary/5 p-5" onSubmit={async event => {
      event.preventDefault()
      const success = await submit(changing ? "change-plan" : "checkout", changing ? { subscriptionId: subscription.id, planId: selected.id } : { planId: selected.id, payerEmail: email })
      if (success) setSelected(null)
    }}>
      <h3 className="text-lg font-semibold">Confirmar {selected.name}</h3>
      <p className="text-sm leading-relaxed">{money(selected.monthlyCents)} por mês. {changing ? "O valor recorrente será atualizado no Mercado Pago. Esta ação não gera cálculo proporcional nem estorno das cobranças já processadas." : "Você será orientado a autorizar a assinatura no Mercado Pago. A criação do checkout não confirma um pagamento."}</p>
      {!changing && <label className="field max-w-lg">E-mail do pagador<input type="email" required value={email} onChange={event => setEmail(event.target.value)} maxLength={254} disabled={busy} autoComplete="email" /></label>}
      <div className="flex flex-wrap gap-3"><Button type="button" variant="outline" disabled={busy} onClick={() => setSelected(null)}>Voltar aos planos</Button><Button type="submit" disabled={busy || !account.canEdit || !account.providerConfigured}>{busy ? "Confirmando…" : changing ? "Confirmar alteração de valor" : "Criar checkout no Mercado Pago"}</Button></div>
    </form>}
    <Notice>O catálogo define preço e capacidade comercial. A medição consolidada e o bloqueio automático por franquia ainda não estão ativos. O plano Elite exige uma proposta comercial antes da contratação.</Notice>
  </div>
}
