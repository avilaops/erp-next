"use client"

import { useEffect, useState, type ReactNode } from "react"
import { AlertTriangle, CreditCard, Database, Download, ExternalLink, HardDrive, Info, Users } from "lucide-react"
import { GuardedLink as Link } from "@/components/shell/navigation-guard"
import { Button } from "@/components/ui/button"
import { accountHref } from "./account-navigation"
import { date, money, safeCheckout, statusLabel, type Account, type Subscription } from "./account-types"

export function Notice({ children }: { children: ReactNode }) {
  return <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm leading-relaxed text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0 text-primary" /><div>{children}</div></div>
}

export function SubscriptionSummary({ account, subscription }: { account: Account; subscription?: Subscription }) {
  const plan = account.plans.find(plan => plan.id === subscription?.planId)
  return <dl className="grid gap-5 rounded-xl border border-border bg-muted/20 p-5 sm:grid-cols-2 xl:grid-cols-4">
    {[["Plano", plan?.name || "Sem assinatura cadastrada"], ["Valor mensal", plan ? money(plan.monthlyCents) : "Não contratado"], ["Situação", subscription ? statusLabel(subscription.status) : "Não contratado"], ["Próxima cobrança", date(subscription?.details.nextPaymentDate)]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-semibold">{value}</dd></div>)}
  </dl>
}

export function PaymentPanel({ account, subscription }: { account: Account; subscription?: Subscription }) {
  const checkout = safeCheckout(subscription?.details.checkoutUrl)
  return <div className="space-y-6">
    <SubscriptionSummary account={account} subscription={subscription} />
    <div className="rounded-xl border border-border p-5"><div className="flex items-center gap-3"><CreditCard className="size-5 text-primary" /><h3 className="font-semibold">Pagamento pelo Mercado Pago</h3></div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">A forma de pagamento é escolhida no ambiente seguro do Mercado Pago. Os meios disponíveis são apresentados pelo provedor durante a autorização da assinatura.</p>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">Meio confirmado</dt><dd className="mt-1 text-sm">{subscription?.details.paymentMethod || "Ainda não informado pelo Mercado Pago"}</dd></div><div><dt className="text-xs text-muted-foreground">Início da assinatura</dt><dd className="mt-1 text-sm">{date(subscription?.details.startedAt)}</dd></div></dl>
      {checkout && subscription?.status === "pending" && account.canEdit && <a href={checkout} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Autorizar no Mercado Pago<ExternalLink className="size-4" /></a>}
    </div>
    <Notice>Vencimento e situação são consultados no Mercado Pago. Para conferir as cobranças, acesse o <Link href={accountHref("extrato")} className="font-medium text-primary underline">extrato da conta</Link>. A emissão de NFS-e da assinatura ainda não está disponível.</Notice>
    {!subscription && <Link href={accountHref("plano")} className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline">Conhecer os planos</Link>}
  </div>
}

type Invoice = { id: string | number; description: string; amount: string | number; currency: string; dueDate: string | null; status: string; paymentStatus: string | null }
const invoiceStatus = (value: string) => ({ approved: "Pago", rejected: "Recusado", pending: "Pendente", scheduled: "Programada", processed: "Processada", cancelled: "Cancelada", refunded: "Reembolsada", in_process: "Em processamento" }[value] || "Em conferência")

export function StatementPanel({ account }: { account: Account }) {
  const [selected, setSelected] = useState(account.subscriptions[0]?.id || "")
  const [offset, setOffset] = useState(0)
  const [result, setResult] = useState<{ data: Invoice[]; total: number } | null>(null)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!selected || !account.providerConfigured) return
    const controller = new AbortController()
    fetch(`/api/erp/company-account/invoices?subscriptionId=${encodeURIComponent(selected)}&offset=${offset}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.title || "Não foi possível consultar as cobranças")
      if (!controller.signal.aborted) setResult(data)
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [selected, offset, account.providerConfigured, retry])
  function navigate(next: number) { setResult(null); setError(""); setOffset(next) }
  function download() {
    if (!result) return
    // Prefix every text cell so spreadsheet formulas from external descriptions cannot execute.
    const cell = (value: unknown) => `"'${String(value ?? "").replaceAll('"', '""')}"`
    const rows = [["Descrição", "Valor", "Moeda", "Vencimento", "Situação"], ...result.data.map(item => [item.description, item.amount, item.currency, date(item.dueDate), invoiceStatus(item.paymentStatus || item.status)])]
    const url = URL.createObjectURL(new Blob(["\uFEFF" + rows.map(row => row.map(cell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a"); link.href = url; link.download = "extrato-assinatura-pagina.csv"; link.click(); URL.revokeObjectURL(url)
  }
  return <div className="space-y-5">
    <Notice>Extrato das cobranças da assinatura Ávila ERP, consultadas no Mercado Pago. O arquivo CSV contém a página exibida e não substitui uma nota fiscal.</Notice>
    {account.subscriptions.length > 0 && <label className="field max-w-md">Assinatura<select value={selected} onChange={event => { setSelected(event.target.value); navigate(0) }}>{account.subscriptions.map(item => <option value={item.id} key={item.id}>{account.plans.find(plan => plan.id === item.planId)?.name} · {statusLabel(item.status)} · {date(item.details.startedAt)}</option>)}</select></label>}
    {!selected ? <Empty title="Nenhuma assinatura cadastrada" text="As cobranças aparecerão aqui após a contratação e a confirmação pelo Mercado Pago." /> : !account.providerConfigured ? <Empty title="Consulta de cobranças indisponível" text="A conexão com o Mercado Pago precisa ser configurada pelo administrador." /> : error ? <div role="alert" className="space-y-3"><p>{error}</p><Button variant="outline" onClick={() => { setError(""); setResult(null); setRetry(value => value + 1) }}>Tentar novamente</Button></div> : !result ? <p role="status">Consultando cobranças…</p> : <>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{result.total} cobrança(s)</p><Button variant="outline" onClick={download} disabled={!result.data.length}><Download />Exportar esta página</Button></div>
      <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-muted/40"><tr>{["Descrição", "Valor", "Vencimento", "Situação"].map(label => <th className="p-4 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>{result.data.map(item => <tr key={item.id} className="border-t border-border"><td className="p-4">{item.description || `Cobrança ${item.id}`}</td><td className="p-4">{item.currency === "BRL" && Number.isFinite(Number(item.amount)) ? money(Math.round(Number(item.amount) * 100)) : `${item.amount} ${item.currency}`}</td><td className="p-4">{date(item.dueDate)}</td><td className="p-4">{invoiceStatus(item.paymentStatus || item.status)}</td></tr>)}{!result.data.length && <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">Nenhuma cobrança retornada pelo Mercado Pago.</td></tr>}</tbody></table></div>
      <div className="flex items-center justify-end gap-3"><Button variant="outline" disabled={offset === 0} onClick={() => navigate(Math.max(0, offset - 10))}>Anterior</Button><span className="text-sm">Página {offset / 10 + 1}</span><Button variant="outline" disabled={offset + 10 >= result.total} onClick={() => navigate(offset + 10)}>Próxima</Button></div>
    </>}
  </div>
}

export function StoragePanel({ account, subscription }: { account: Account; subscription?: Subscription }) {
  const plan = account.plans.find(plan => plan.id === subscription?.planId)
  return <div className="space-y-6"><SubscriptionSummary account={account} subscription={subscription} />
    <div className="grid gap-4 xl:grid-cols-3">
      <Metric icon={<Users className="size-5" />} label="Usuários ativos" value={String(account.activeUsers)} detail={plan ? `Limite do catálogo: ${plan.users ?? "ilimitado"}` : "Membros ativos da empresa"} />
      <Metric icon={<HardDrive className="size-5" />} label="Fotos de produtos" value={`${(account.productPhotoBytes / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} MB`} detail="Tamanho armazenado das fotos, incluindo codificação" />
      <Metric icon={<Database className="size-5" />} label="Dados do plano" value={plan ? `${plan.dataMegabytes.toLocaleString("pt-BR")} MB` : "Sem plano"} detail="Franquia do catálogo comercial" />
    </div>
    <Notice>A contagem de usuários e o tamanho das fotos vêm da empresa ativa. A medição consolidada do banco de dados e dos demais arquivos ainda não está disponível; por isso, não é exibido um percentual de consumo total.</Notice>
    <div className="flex flex-wrap gap-5"><Link href={accountHref("plano")} className="text-sm font-medium text-primary underline">Consultar planos</Link><Link href="/preferencias/usuarios" className="text-sm font-medium text-primary underline">Gerenciar usuários</Link></div>
  </div>
}

export function ImportsPanel({ account, subscription }: { account: Account; subscription?: Subscription }) {
  const plan = account.plans.find(plan => plan.id === subscription?.planId)
  return <div className="space-y-6"><SubscriptionSummary account={account} subscription={subscription} /><div className="rounded-xl border border-border p-5"><p className="text-sm text-muted-foreground">Franquia de importações do catálogo</p><p className="mt-2 text-2xl font-semibold">{plan?.importedOrders ? `${plan.importedOrders} pedidos / mês` : "Não definida para este plano"}</p></div>
    <Empty title="Histórico de importações ainda indisponível" text="O ERP ainda não registra a origem e a medição mensal dos pedidos importados por marketplace ou API. Pedidos manuais e histórico legado não são contados como importações desta assinatura." />
    <Notice>Não há mudança automática de plano por volume de importações. A contratação e qualquer alteração de valor exigem uma ação explícita na área de planos.</Notice>
  </div>
}

export function Empty({ title, text }: { title: string; text: string }) {
  return <div className="rounded-xl border border-dashed border-border bg-muted/20 px-5 py-10 text-center"><h3 className="font-semibold">{title}</h3><p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">{text}</p></div>
}
function Metric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return <div className="rounded-xl border border-border p-5"><div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">{icon}{label}</div><strong className="text-2xl font-semibold">{value}</strong><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p></div>
}

export function CancellationPanel({ account, subscription, busy, cancel }: { account: Account; subscription?: Subscription; busy: boolean; cancel: () => Promise<boolean> }) {
  const [step, setStep] = useState(0)
  const [confirmation, setConfirmation] = useState("")
  if (!subscription || subscription.status === "cancelled") return <Empty title={subscription ? "Assinatura cancelada" : "Nenhuma assinatura para cancelar"} text="O cancelamento de cobrança não exclui os cadastros e documentos da empresa." />
  return <div className="space-y-6"><SubscriptionSummary account={account} subscription={subscription} />
    <div className="flex gap-4 rounded-xl border border-amber-500/40 bg-amber-500/5 p-5"><AlertTriangle className="mt-1 size-6 shrink-0 text-amber-600 dark:text-amber-400" /><div><h3 className="text-lg font-semibold">{step === 0 ? "Antes de cancelar" : "Confirme o cancelamento da assinatura"}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">O cancelamento é enviado ao Mercado Pago para interromper as próximas cobranças recorrentes. Cobranças já processadas não são estornadas por esta ação. Os dados da empresa permanecem armazenados.</p></div></div>
    {step === 0 ? <Button variant="outline" disabled={!account.canEdit || !account.providerConfigured || busy || subscription.status === "creating"} onClick={() => setStep(1)}>Continuar para confirmação</Button> : <form className="space-y-5" onSubmit={async event => { event.preventDefault(); if (confirmation === "CANCELAR" && await cancel()) { setStep(0); setConfirmation("") } }}><label className="field max-w-md">Digite CANCELAR para confirmar<input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" disabled={busy} /></label><div className="flex flex-wrap gap-3"><Button type="button" variant="outline" disabled={busy} onClick={() => { setStep(0); setConfirmation("") }}>Manter assinatura</Button><Button type="submit" variant="destructive" disabled={confirmation !== "CANCELAR" || busy || !account.canEdit || !account.providerConfigured}>{busy ? "Confirmando…" : "Cancelar assinatura no Mercado Pago"}</Button></div></form>}
  </div>
}
