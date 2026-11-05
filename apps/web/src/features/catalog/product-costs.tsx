"use client"

import { useState } from "react"
import Link from "next/link"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RequestError } from "@/components/feedback/session-recovery"
import { useResource } from "@/hooks/use-operation"
import { useNavigationGuard } from "@/components/shell/navigation-guard"

type Cost = { productLine: "imported" | "national"; purchaseCostCents: number; taxCreditBps: number; packagingCents: number }
type Snapshot = { tenantId: string; productId: string; productName: string; revision: number; canEdit: boolean; data: Cost | null }
const fields = [["purchaseCostCents", "Custo de compra / assessoria (R$)"], ["taxCreditBps", "Crédito tributário (%)"], ["packagingCents", "Embalagem (R$)"]] as const

function hundredths(raw: string, label: string, max: number) {
  const normalized = raw.trim().replace(",", ".")
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(normalized)) throw Error(`${label}: use até duas casas decimais, sem separador de milhar.`)
  const [whole, fraction = ""] = normalized.split(".")
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
  if (!Number.isSafeInteger(value) || value > max) throw Error(`${label}: valor acima do limite.`)
  return value
}

export function ProductCosts({ id }: { id: string }) {
  const resource = useResource<Snapshot>(`/api/erp/product-costs/${id}`)
  return <main className="mx-auto max-w-3xl space-y-5 px-4 pb-24 pt-6">
    <PageHeader eyebrow="Cadastros · Produtos" title="Custos do produto" description="Dados gerenciais para formar a tabela de preços. Acesso restrito à gestão." />
    <Link className="text-primary underline" href={`/cadastros/produtos/${id}`}>Voltar ao produto</Link>
    {resource.loading ? <p role="status">Carregando custos…</p> : resource.error ? <p role="alert"><RequestError message={resource.error} status={resource.status} /></p> : resource.value?.productId === id && <Editor key={`${id}:${resource.value.revision}`} snapshot={resource.value} etag={resource.etag} reload={resource.reload} />}
  </main>
}

function Editor({ snapshot, etag, reload }: { snapshot: Snapshot; etag: string; reload: () => void }) {
  const [line, setLine] = useState<Cost["productLine"]>(snapshot.data?.productLine || "imported")
  const [values, setValues] = useState(() => Object.fromEntries(fields.map(([key]) => [key, snapshot.data ? String(snapshot.data[key] / 100).replace(".", ",") : ""])) as Record<typeof fields[number][0], string>)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  useNavigationGuard(dirty ? "Descartar os custos não salvos?" : null)
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!dirty || busy || blocked || !etag || !snapshot.canEdit) return
    let body: Cost
    try {
      body = { productLine: line, purchaseCostCents: hundredths(values.purchaseCostCents, "Custo", 1_000_000_000_000), taxCreditBps: hundredths(values.taxCreditBps, "Crédito", 10_000), packagingCents: hundredths(values.packagingCents, "Embalagem", 1_000_000_000_000) }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Valores inválidos"); return }
    setBusy(true); setError(""); setSaved(false)
    try {
      const response = await fetch(`/api/erp/product-costs/${snapshot.productId}`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Tenant-Id": snapshot.tenantId, "If-Match": etag }, body: JSON.stringify(body) })
      const result = await response.json()
      if (!response.ok) throw Error(result.title || "Não foi possível salvar.")
      if (result.tenantId !== snapshot.tenantId || result.productId !== snapshot.productId || result.revision !== snapshot.revision + 1 || response.headers.get("etag") !== `"${result.revision}"`) throw Error("Confirmação incompleta. Recarregue para conferir.")
      setDirty(false); setSaved(true); reload()
    } catch (reason) { setBlocked(true); setError(reason instanceof Error ? reason.message : "Falha ao confirmar gravação.") }
    finally { setBusy(false) }
  }
  return <section className="form-section space-y-4">
    <h2 className="font-semibold">{snapshot.productName}</h2>
    <p>Salvar custos não publica a tabela nem altera preços ou pedidos existentes.</p>
    <form className="space-y-4" onSubmit={save}><fieldset className="space-y-4" disabled={busy || blocked || !snapshot.canEdit || !etag}>
      <label className="grid gap-1">Linha comercial<select className="min-h-10 rounded-lg border bg-background px-2" value={line} onChange={e => { setLine(e.target.value as Cost["productLine"]); setDirty(true) }}><option value="imported">Importada</option><option value="national">Nacional</option></select></label>
      {fields.map(([key, label]) => <label className="grid gap-1" key={key}>{label}<Input required inputMode="decimal" value={values[key]} onChange={e => { setValues({ ...values, [key]: e.target.value }); setDirty(true) }} /></label>)}
      <Button type="submit" disabled={!dirty}>Salvar custos</Button>
    </fieldset></form>
    {saved && <p role="status">Custos salvos.</p>}{error && <p role="alert">{error} Sua edição foi preservada.</p>}
    {blocked && <Button variant="outline" onClick={reload}>Recarregar custos</Button>}
  </section>
}

