"use client"

import { useEffect, useState } from "react"
import { RefreshCw, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AccessLink } from "@/components/session-recovery"
import { accountSections, type AccountSection } from "./account-navigation"
import { CancellationPanel, ImportsPanel, Notice, PaymentPanel, StatementPanel, StoragePanel } from "./account-panels"
import { PlansPanel } from "./plans-panel"
import { date, safeCheckout, type Account } from "./account-types"

export function AccountClient({ section }: { section: AccountSection }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [error, setError] = useState("")
  const [unauthorized, setUnauthorized] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const [notice, setNotice] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/erp/company-account", { cache: "no-store", signal: controller.signal }).then(async response => {
      const value = await response.json()
      if (!response.ok) { if (!controller.signal.aborted) setUnauthorized(response.status === 401); throw new Error(value.title || "Não foi possível carregar a conta") }
      if (!controller.signal.aborted) setAccount(value)
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [reload])

  async function submit(action: string, body: object) {
    if (!account || !account.canEdit || busy) return false
    setBusy(true); setError(""); setNotice("")
    try {
      const response = await fetch(`/api/erp/company-account/${action}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": account.tenantId }, body: JSON.stringify(body) })
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Não foi possível confirmar a operação")
      setAccount(current => current ? { ...current, subscriptions: [value, ...current.subscriptions.filter(item => item.id !== value.id)] } : current)
      setNotice(action === "checkout" ? "Checkout criado. A assinatura aguarda autorização no Mercado Pago." : action === "cancel" ? "Cancelamento confirmado pelo Mercado Pago." : action === "change-plan" ? "Valor recorrente atualizado no Mercado Pago." : "Assinatura consultada no Mercado Pago.")
      return true
    } catch (error) {
      setError(error instanceof Error ? error.message : "Não foi possível confirmar a operação")
      // Recover a reservation created before a timeout; a new checkout stays blocked.
      setReload(value => value + 1)
      return false
    } finally { setBusy(false) }
  }

  if (!account) return <section className="form-section space-y-4">{error ? <><p role="alert">{error}</p>{unauthorized ? <AccessLink /> : <Button variant="outline" onClick={() => { setError(""); setReload(value => value + 1) }}>Tentar novamente</Button>}</> : <p role="status">Carregando conta da empresa…</p>}</section>
  const subscription = account.subscriptions.find(item => !["cancelled", "rejected"].includes(item.status)) || account.subscriptions[0]
  const checkout = subscription?.status === "pending" ? safeCheckout(subscription.details.checkoutUrl) : null
  return <section className="space-y-6 rounded-2xl border border-border bg-card p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold tracking-tight">{accountSections[section]}</h2><p className="mt-1 text-sm text-muted-foreground">Assinatura e gerenciamento da empresa ativa</p></div>{subscription && <Button variant="outline" className="min-h-11" disabled={busy || !account.canEdit || !account.providerConfigured} onClick={() => submit("refresh", { subscriptionId: subscription.id })}><RefreshCw className={busy ? "animate-spin" : ""} />Atualizar assinatura</Button>}</div>
    {!account.canEdit && <p role="status" className="text-sm text-muted-foreground">Acesso de consulta. Alterações exigem permissão de gerenciamento da empresa.</p>}
    {!account.providerConfigured && <Notice>A conexão de assinaturas com o Mercado Pago ainda não foi configurada neste ambiente. A contratação e as alterações de cobrança estão indisponíveis.</Notice>}
    {error && <div role="alert" className="rounded-xl border border-destructive/40 p-4 text-sm">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">{notice}</div>}
    {checkout && account.canEdit && section !== "pagamento" && <a className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground" href={checkout}>Continuar no Mercado Pago<ExternalLink className="size-4" /></a>}
    {section === "pagamento" && <PaymentPanel account={account} subscription={subscription} />}
    {section === "extrato" && <StatementPanel account={account} />}
    {section === "armazenamento" && <StoragePanel account={account} subscription={subscription} />}
    {section === "importacoes" && <ImportsPanel account={account} subscription={subscription} />}
    {section === "plano" && <PlansPanel account={account} subscription={subscription} busy={busy} submit={submit} />}
    {section === "cancelamento" && <CancellationPanel account={account} subscription={subscription} busy={busy} cancel={() => submit("cancel", { subscriptionId: subscription?.id, confirmation: "CANCELAR" })} />}
    {subscription?.details.checkedAt && <p className="border-t border-border pt-4 text-xs text-muted-foreground">Última consulta ao Mercado Pago: {date(subscription.details.checkedAt)}. Use “Atualizar assinatura” após concluir uma ação no provedor.</p>}
  </section>
}
