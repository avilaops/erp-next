"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/page-header"
import { RequestError } from "@/components/feedback/session-recovery"
import { useResource } from "@/hooks/use-operation"
import { useNavigationGuard } from "@/components/shell/navigation-guard"
import { fieldGroups, states, toDraft, toParameters, type Calculation, type Draft, type Snapshot } from "./commercial-parameters"

export function CommercialSettings() {
  const [line, setLine] = useState<"imported" | "national">("imported")
  const resource = useResource<Snapshot>(`/api/erp/commercial-settings/${line}`)
  return <main className="mx-auto max-w-6xl space-y-5 px-4 pb-24 pt-6">
    <PageHeader eyebrow="Preferências" title="Parâmetros comerciais" description="Política de preço por linha e simulação gerencial. Acesso restrito à gestão da empresa." />
    <div className="flex gap-2" aria-label="Linha de produto">
      <Button type="button" variant={line === "imported" ? "default" : "outline"} aria-pressed={line === "imported"} onClick={() => { if (line !== "imported" && (!document.querySelector("form[data-commercial-dirty='true']") || window.confirm("Descartar a edição não salva?"))) setLine("imported") }}>Importada</Button>
      <Button type="button" variant={line === "national" ? "default" : "outline"} aria-pressed={line === "national"} onClick={() => { if (line !== "national" && (!document.querySelector("form[data-commercial-dirty='true']") || window.confirm("Descartar a edição não salva?"))) setLine("national") }}>Nacional</Button>
    </div>
    {resource.loading ? <p role="status">Carregando parâmetros…</p> : resource.error ? <p role="alert"><RequestError message={resource.error} status={resource.status} /></p> : resource.value && <Editor key={`${resource.value.tenantId}:${line}:${resource.value.revision}`} snapshot={resource.value} etag={resource.etag} reload={resource.reload} />}
  </main>
}

function Editor({ snapshot, etag, reload }: { snapshot: Snapshot; etag: string; reload: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(snapshot.data))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [calculation, setCalculation] = useState<Calculation | null>(snapshot.calculation)
  useNavigationGuard(dirty ? "Descartar os parâmetros comerciais não salvos?" : null)
  function change(next: Draft) { setDraft(next); setDirty(true); setCalculation(null); setError(""); setNotice("") }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || blocked || !snapshot.canEdit) return
    const save = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "save"
    if (save && !etag) { setBlocked(true); setError("Revisão ausente. Recarregue antes de salvar."); return }
    let parameters
    try { parameters = toParameters(draft) } catch (reason) { setError(reason instanceof Error ? reason.message : "Parâmetros inválidos"); return }
    setBusy(true); setError(""); setNotice("")
    try {
      const response = await fetch(`/api/erp/commercial-settings/${snapshot.line}${save ? "" : "/preview"}`, {
        method: save ? "PUT" : "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": snapshot.tenantId, ...(save ? { "If-Match": etag } : {}) }, body: JSON.stringify(parameters),
      })
      const result = await response.json()
      if (!response.ok) throw Error(result.title || "Operação recusada")
      if (result.tenantId !== snapshot.tenantId || result.line !== snapshot.line || !result.calculation || (save && (!response.headers.get("etag") || result.revision !== snapshot.revision + 1))) throw Error("Confirmação incompleta. Recarregue para conferir.")
      if (save) { setDirty(false); setNotice("Parâmetros salvos. A tabela de preços ainda não foi publicada."); reload() } else setCalculation(result.calculation)
    } catch (reason) { if (save) setBlocked(true); setError(reason instanceof Error ? reason.message : "Falha na operação") }
    finally { setBusy(false) }
  }
  return <form className="space-y-5" data-commercial-dirty={dirty} onSubmit={submit}>
    {notice && <p role="status">{notice}</p>}
    {!snapshot.data && <p role="status">Esta linha ainda não tem parâmetros. Informe as alíquotas da empresa.</p>}
    <fieldset disabled={busy || blocked || !snapshot.canEdit} className="space-y-5">
      <label className="grid max-w-sm gap-2">UF de origem<select required className="min-h-10 rounded-lg border bg-background px-2" value={draft.originState} onChange={e => change({ ...draft, originState: e.target.value })}><option value="">Selecione</option>{states.map(state => <option key={state}>{state}</option>)}</select></label>
      {fieldGroups.map(group => <section className="form-section space-y-3" key={group.title}><h2 className="font-semibold">{group.title}</h2><div className="grid gap-3 sm:grid-cols-2">{group.fields.map(([key, label, unit]) => <label key={key} className="grid gap-1">{label} ({unit === "percent" ? "%" : unit === "money" ? "R$" : "dias"})<Input required inputMode={unit === "days" ? "numeric" : "decimal"} value={draft[key]} onChange={e => change({ ...draft, [key]: e.target.value })} /></label>)}</div></section>)}
      <section className="form-section space-y-3"><h2 className="font-semibold">ICMS por UF de destino</h2><p>Saída em branco usa a alíquota interestadual padrão. Zero é um valor explícito.</p><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{draft.stateRates.map((row, index) => <fieldset key={row.state} className="rounded-lg border p-3"><legend>{row.state}</legend><div className="grid grid-cols-3 gap-2">{([ ["internalBps", "Interno"], ["fcpBps", "FCP"], ["outgoingBps", "Saída"] ] as const).map(([key, label]) => <label key={key} className="grid gap-1 text-xs">{label}<Input aria-label={`${row.state} ${label}`} required={key !== "outgoingBps"} inputMode="decimal" value={row[key]} onChange={e => change({ ...draft, stateRates: draft.stateRates.map((item, position) => position === index ? { ...item, [key]: e.target.value } : item) })} /></label>)}</div></fieldset>)}</div></section>
      <div className="flex gap-3"><Button type="submit" value="preview" variant="outline">Simular</Button><Button type="submit" value="save" disabled={!dirty}>Salvar parâmetros</Button></div>
    </fieldset>
    {error && <p role="alert">{error}. Sua edição foi preservada.</p>}
    {blocked && <Button type="button" onClick={() => { if (window.confirm("Descartar edição e recarregar?")) { setDirty(false); reload() } }}>Recarregar</Button>}
    {calculation && <section className="form-section space-y-2"><h2 className="font-semibold">Resultado gerencial</h2><p>Pior destino: {calculation.worstState}</p><p>Preço de tabela: custo ajustado × {calculation.tableCostMultiplier.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}</p><p>Markup: {calculation.markupPercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</p><p>Tributos, taxas e provisões: {(calculation.variableCostsBps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</p><p>Faturamento de equilíbrio: {calculation.breakEvenRevenue == null ? "Sem equilíbrio nesta condição" : calculation.breakEvenRevenue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p></section>}
  </form>
}
