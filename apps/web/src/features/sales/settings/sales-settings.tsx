"use client"

import Link from "next/link"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/page-header"
import { RequestError } from "@/components/feedback/session-recovery"
import { useNavigationGuard } from "@/components/shell/navigation-guard"
import { erpFetch } from "@/lib/api/client"
import { decimalPattern, normalizeDecimal } from "@/lib/decimal-input"
import { useResource } from "@/hooks/use-operation"

type Settings = { minimumOrderAmount: string; maximumPaymentTermDays: number; requireCustomerContact: boolean }
export type SalesSettingsSnapshot = { tenantId: string; revision: number; canEdit: boolean; data: Settings | null }
type Draft = { minimumOrderAmount: string; maximumPaymentTermDays: string; requireCustomerContact: string }
const empty: Draft = { minimumOrderAmount: "", maximumPaymentTermDays: "", requireCustomerContact: "" }
const draftOf = (data: Settings | null): Draft => data ? { minimumOrderAmount: data.minimumOrderAmount, maximumPaymentTermDays: String(data.maximumPaymentTermDays), requireCustomerContact: String(data.requireCustomerContact) } : empty

export function SalesSettings() {
  const resource = useResource<SalesSettingsSnapshot>("/api/erp/sales-settings")
  const [edit, setEdit] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const pending = useRef(false)
  const draft = edit ?? draftOf(resource.value?.data ?? null)
  const dirty = !!resource.value && JSON.stringify(draft) !== JSON.stringify(draftOf(resource.value.data))
  const amount = normalizeDecimal(draft.minimumOrderAmount)
  const termValid = /^(0|[1-9][0-9]{0,3})$/.test(draft.maximumPaymentTermDays) && Number(draft.maximumPaymentTermDays) <= 3650
  const valid = amount !== null && termValid && ["true", "false"].includes(draft.requireCustomerContact)
  useNavigationGuard(dirty ? "Descartar as configurações de vendas ainda não salvas?" : null)
  const frozen = !resource.value?.canEdit || busy || blocked || resource.loading

  function reload() {
    if (dirty && !window.confirm("Descartar sua edição e carregar as configurações atuais?")) return
    setEdit(null); setBlocked(false); setError(""); setNotice(""); resource.reload()
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (frozen || !dirty || !valid || pending.current || !resource.value || !resource.etag) return
    pending.current = true; setBusy(true); setError(""); setNotice("")
    try {
      const response = await erpFetch("/api/erp/sales-settings", { method: "PUT", headers: { "Content-Type": "application/json", "X-Tenant-Id": resource.value.tenantId, "If-Match": resource.etag }, body: JSON.stringify({ minimumOrderAmount: amount, maximumPaymentTermDays: Number(draft.maximumPaymentTermDays), requireCustomerContact: draft.requireCustomerContact === "true" }) })
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Não foi possível salvar as configurações")
      if (value.tenantId !== resource.value.tenantId || !response.headers.get("etag") || !value.data) throw new Error("Confirmação incompleta. Recarregue para conferir a gravação")
      setEdit(null); setNotice("Configurações de vendas salvas para esta empresa."); resource.reload()
    } catch (reason) { setBlocked(true); setError(reason instanceof Error ? reason.message : "Não foi possível confirmar a gravação") }
    finally { pending.current = false; setBusy(false) }
  }

  return <div className="mx-auto max-w-4xl space-y-6 px-4 pb-28 pt-8 lg:px-6">
    <PageHeader eyebrow="Preferências / Vendas" title="Configurações de vendas" description="Regras verificadas ao confirmar os pedidos desta empresa." />
    <Link className="inline-flex min-h-11 items-center text-primary underline" href="/preferencias?categoria=vendas">Voltar às preferências de vendas</Link>
    {resource.loading && <p role="status">Carregando configurações de vendas…</p>}
    {resource.error && <p role="alert"><RequestError message={resource.error} status={resource.status} /></p>}
    {resource.value && <form onSubmit={save} className="form-section space-y-5">
      {!resource.value.data && <p role="status">Nenhuma regra de vendas configurada. Preencha os três campos para começar.</p>}
      <fieldset disabled={frozen} className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2"><label className="block text-sm" htmlFor="sales-minimum">Valor mínimo do pedido</label><Input id="sales-minimum" inputMode="decimal" required pattern={decimalPattern(2)} maxLength={15} value={draft.minimumOrderAmount} onChange={event => setEdit({ ...draft, minimumOrderAmount: event.target.value })} /><p className="text-xs text-muted-foreground">Valor em reais. Informe zero para permitir qualquer valor comercial positivo.</p></div>
        <div className="space-y-2"><label className="block text-sm" htmlFor="sales-term">Prazo máximo de recebimento em dias</label><Input id="sales-term" type="number" required min={0} max={3650} step={1} value={draft.maximumPaymentTermDays} onChange={event => setEdit({ ...draft, maximumPaymentTermDays: event.target.value })} /><p className="text-xs text-muted-foreground">Até 3.650 dias a partir da data de confirmação, no horário de Brasília. Zero permite vencimento até o mesmo dia.</p></div>
        <div className="space-y-2"><label className="block text-sm" htmlFor="sales-contact">Exigir contato do cliente</label><select id="sales-contact" className="min-h-11 w-full rounded-lg border bg-background px-3" required value={draft.requireCustomerContact} onChange={event => setEdit({ ...draft, requireCustomerContact: event.target.value })}><option value="">Selecione</option><option value="true">Sim, exigir e-mail ou telefone</option><option value="false">Não exigir</option></select><p className="text-xs text-muted-foreground">Quando exigido, o cadastro do cliente deve conter e-mail ou telefone antes da confirmação.</p></div>
      </fieldset>
      <p className="text-sm text-muted-foreground">As regras são aplicadas na próxima confirmação de pedido. Pedidos já confirmados seguem seu fluxo de conclusão.</p>
      {!resource.value.canEdit && <p className="text-sm">Somente consulta. Alterações exigem gestão da empresa.</p>}
      {error && <p role="alert">{error} Sua edição foi preservada.</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={frozen || !dirty || !valid || !resource.etag}>{busy ? "Salvando…" : "Salvar configurações de vendas"}</Button><Button type="button" variant="outline" disabled={busy || resource.loading} onClick={reload}>Recarregar configurações</Button></div>
    </form>}
    {resource.error && <Button variant="outline" onClick={reload}>Tentar novamente</Button>}
  </div>
}

export function OrderSalesRules({ tenantId }: { tenantId: string }) {
  const resource = useResource<SalesSettingsSnapshot>("/api/erp/sales-settings")
  const settings = resource.value?.tenantId === tenantId ? resource.value.data : null
  return <section className="rounded-xl border p-4 text-sm" aria-label="Regras de confirmação de vendas">
    {resource.loading ? <p>Consultando regras de vendas…</p> : resource.error ? <p><RequestError message={resource.error} status={resource.status} /></p> : settings ? <ul className="space-y-1"><li>Valor mínimo: R$ {settings.minimumOrderAmount.replace(".", ",")}</li><li>Prazo máximo: {settings.maximumPaymentTermDays} dia(s) a partir da confirmação.</li><li>Contato do cliente: {settings.requireCustomerContact ? "e-mail ou telefone obrigatório" : "opcional"}.</li></ul> : <p>Nenhuma regra adicional de vendas configurada.</p>}
    <Link className="mt-2 inline-flex min-h-11 items-center text-primary underline" href="/preferencias/vendas">Consultar configurações de vendas</Link>
  </section>
}
