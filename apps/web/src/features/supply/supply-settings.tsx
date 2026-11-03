"use client"

import { useRef, useState, type FormEvent } from "react"
import { GuardedLink as Link, useNavigationGuard } from "@/components/shell/navigation-guard"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RequestError } from "@/components/feedback/session-recovery"
import { useResource } from "@/hooks/use-operation"
import { erpFetch } from "@/lib/api/client"
import { decimalPattern, normalizeDecimal } from "@/lib/decimal-input"

type Kind = "estoque" | "compras"
type InventorySettings = { allowManualMovements: boolean; minimumReasonLength: number }
type PurchaseSettings = { minimumOrderAmount: string; maximumPaymentTermDays: number; requireSupplierContact: boolean }
type Snapshot = { tenantId: string; revision: number; canEdit: boolean; data: InventorySettings | PurchaseSettings | null }
type Draft = Record<string, string>
const definitions = {
  estoque: {
    endpoint: "inventory-settings", title: "Configurações de estoque",
    description: "Regras aplicadas aos lançamentos e estornos manuais desta empresa.",
    empty: { allowManualMovements: "true", minimumReasonLength: "3" } as Draft,
  },
  compras: {
    endpoint: "purchase-settings", title: "Configurações de pedidos de compras",
    description: "Regras verificadas ao confirmar um pedido de compra desta empresa.",
    empty: { minimumOrderAmount: "", maximumPaymentTermDays: "", requireSupplierContact: "" } as Draft,
  },
}

function draftOf(kind: Kind, data: Snapshot["data"]): Draft {
  return data ? Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)])) : definitions[kind].empty
}

export function SupplySettings({ kind }: { kind: Kind }) {
  const config = definitions[kind]
  const resource = useResource<Snapshot>(`/api/erp/${config.endpoint}`)
  const [edit, setEdit] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const pending = useRef(false)
  const draft = edit ?? draftOf(kind, resource.value?.data ?? null)
  const dirty = edit !== null && JSON.stringify(draft) !== JSON.stringify(draftOf(kind, resource.value?.data ?? null))
  const frozen = busy || blocked || resource.loading || !resource.value?.canEdit
  const amount = kind === "compras" ? normalizeDecimal(draft.minimumOrderAmount) : null
  const integer = (value: string, minimum: number, maximum: number) => /^(0|[1-9][0-9]*)$/.test(value) && Number(value) >= minimum && Number(value) <= maximum
  const valid = kind === "estoque"
    ? ["true", "false"].includes(draft.allowManualMovements) && integer(draft.minimumReasonLength, 3, 200)
    : amount !== null && integer(draft.maximumPaymentTermDays, 0, 3650) && ["true", "false"].includes(draft.requireSupplierContact)
  useNavigationGuard(dirty ? "Descartar as configurações de suprimentos ainda não salvas?" : null)

  function change(key: string, value: string) { setEdit({ ...draft, [key]: value }); setNotice("") }
  function reload() {
    if (dirty && !window.confirm("Descartar sua edição e carregar as configurações atuais?")) return
    setEdit(null); setBlocked(false); setError(""); setNotice(""); resource.reload()
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (frozen || !valid || pending.current || !resource.value || !resource.etag) return
    pending.current = true; setBusy(true); setError(""); setNotice("")
    const body: InventorySettings | PurchaseSettings = kind === "estoque"
      ? { allowManualMovements: draft.allowManualMovements === "true", minimumReasonLength: Number(draft.minimumReasonLength) }
      : { minimumOrderAmount: amount!, maximumPaymentTermDays: Number(draft.maximumPaymentTermDays), requireSupplierContact: draft.requireSupplierContact === "true" }
    try {
      const response = await erpFetch(`/api/erp/${config.endpoint}`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Tenant-Id": resource.value.tenantId, "If-Match": resource.etag }, body: JSON.stringify(body) })
      const value: Snapshot & { title?: string } = await response.json()
      if (!response.ok) throw new Error(value.title || "Não foi possível salvar as configurações")
      if (value.tenantId !== resource.value.tenantId || !value.data || !response.headers.get("etag")) throw new Error("Confirmação incompleta. Recarregue para conferir a gravação")
      setEdit(null); setNotice("Configurações salvas para esta empresa."); resource.reload()
    } catch (reason) {
      setBlocked(true); setError(reason instanceof Error ? reason.message : "Não foi possível confirmar a gravação")
    } finally { pending.current = false; setBusy(false) }
  }
  function booleanField(key: string, label: string, yes: string, no: string) {
    return <label className="block space-y-2">{label}<select className="min-h-11 w-full rounded-lg border bg-background px-3" required value={draft[key]} onChange={event => change(key, event.target.value)}><option value="">Selecione</option><option value="true">{yes}</option><option value="false">{no}</option></select></label>
  }
  return <div className="mx-auto max-w-4xl space-y-6 px-4 pb-28 pt-8 lg:px-6">
    <PageHeader eyebrow="Preferências / Suprimentos" title={config.title} description={config.description} />
    <Link className="inline-flex min-h-11 items-center text-primary underline" href="/preferencias?categoria=suprimentos">Voltar às preferências de suprimentos</Link>
    {resource.loading && <p role="status">Carregando configurações…</p>}
    {resource.error && <div role="alert"><RequestError message={resource.error} status={resource.status} /><Button variant="outline" onClick={reload}>Tentar novamente</Button></div>}
    {resource.value && <form className="form-section space-y-5" onSubmit={save}>
      {!resource.value.data && <p role="status">{kind === "estoque" ? "Padrão atual: lançamentos manuais permitidos e motivo com pelo menos 3 caracteres." : "Nenhuma regra adicional de compras configurada. Preencha os três campos para começar."}</p>}
      <fieldset className="grid gap-5 sm:grid-cols-2" disabled={frozen}>
        {kind === "estoque" ? <>
          {booleanField("allowManualMovements", "Permitir lançamentos manuais", "Sim, permitir lançamentos e estornos manuais", "Não, bloquear lançamentos e estornos manuais")}
          <label className="block space-y-2">Tamanho mínimo do motivo<Input type="number" min={3} max={200} step={1} required value={draft.minimumReasonLength} onChange={event => change("minimumReasonLength", event.target.value)} /><span className="text-xs text-muted-foreground">De 3 a 200 caracteres.</span></label>
        </> : <>
          <label className="block space-y-2">Valor mínimo do pedido<Input inputMode="decimal" required pattern={decimalPattern(2)} maxLength={15} value={draft.minimumOrderAmount} onChange={event => change("minimumOrderAmount", event.target.value)} /><span className="text-xs text-muted-foreground">Em reais. Zero permite qualquer valor positivo.</span></label>
          <label className="block space-y-2">Prazo máximo de pagamento em dias<Input type="number" min={0} max={3650} step={1} required value={draft.maximumPaymentTermDays} onChange={event => change("maximumPaymentTermDays", event.target.value)} /><span className="text-xs text-muted-foreground">Contado a partir da confirmação, no horário de Brasília. Zero limita o vencimento ao mesmo dia.</span></label>
          {booleanField("requireSupplierContact", "Exigir contato do fornecedor", "Sim, exigir e-mail ou telefone", "Não exigir")}
        </>}
      </fieldset>
      <p className="text-sm text-muted-foreground">{kind === "estoque" ? "As regras valem para novas operações manuais. Recebimentos de compras e movimentações de vendas continuam seguindo seus próprios fluxos." : "As regras valem para a próxima confirmação. Pedidos já confirmados seguem o fluxo de recebimento existente."}</p>
      {!resource.value.canEdit && <p>Somente consulta. Alterações exigem gestão da empresa.</p>}
      {error && <p role="alert">{error} Sua edição foi preservada. Recarregue para conferir o estado atual antes de salvar novamente.</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={frozen || !valid || !resource.etag || (!dirty && !!resource.value.data)}>{busy ? "Salvando…" : "Salvar configurações"}</Button><Button type="button" variant="outline" disabled={busy || resource.loading} onClick={reload}>Recarregar configurações</Button></div>
    </form>}
  </div>
}
