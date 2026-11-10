"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/workspace/data-table"
import { PageHeader } from "@/components/page-header"
import { RequestError } from "@/components/feedback/session-recovery"
import { useResource } from "@/hooks/use-operation"
import { useNavigationGuard } from "@/components/shell/navigation-guard"
import { fieldGroups, states, toDraft, toParameters, type Calculation, type Draft, type Snapshot } from "./commercial-parameters"

export function CommercialSettings() {
  const [line, setLine] = useState<"imported" | "national">("imported")
  const resource = useResource<Snapshot>(`/api/erp/commercial-settings/${line}`)
  return <div className="mx-auto min-w-0 max-w-6xl space-y-3 px-4 pb-24 pt-6">
    <PageHeader breadcrumbs={[{ label: "Preferências", href: "/preferencias" }, { label: "Parâmetros comerciais" }]} title="Parâmetros comerciais" description="Configure a política de preços e confira o resultado por linha comercial." />
    <nav aria-label="Atalhos comerciais" className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:flex sm:flex-wrap sm:gap-x-4"><Link className="py-1 text-primary underline" href="/preferencias/despesas-fixas">Despesas fixas</Link><Link className="py-1 text-primary underline" href="/preferencias/tabela-precos">Publicar tabela</Link><Link className="py-1 text-primary underline" href="/preferencias/aprovacao-comercial">Regras de aprovação</Link><Link className="py-1 text-primary underline" href="/vendas/simulador">Simulador comercial</Link></nav>
    <div className="flex gap-2" aria-label="Linha de produto">
      <Button type="button" variant={line === "imported" ? "default" : "outline"} aria-pressed={line === "imported"} onClick={() => { if (line !== "imported" && (!document.querySelector("form[data-commercial-dirty='true']") || window.confirm("Descartar a edição não salva?"))) setLine("imported") }}>Importada</Button>
      <Button type="button" variant={line === "national" ? "default" : "outline"} aria-pressed={line === "national"} onClick={() => { if (line !== "national" && (!document.querySelector("form[data-commercial-dirty='true']") || window.confirm("Descartar a edição não salva?"))) setLine("national") }}>Nacional</Button>
    </div>
    {resource.loading ? <p role="status">Carregando parâmetros…</p> : resource.error ? <p role="alert"><RequestError message={resource.error} status={resource.status} /></p> : resource.value && <Editor key={`${resource.value.tenantId}:${line}:${resource.value.revision}`} snapshot={resource.value} etag={resource.etag} reload={resource.reload} />}
  </div>
}
function Editor({ snapshot, etag, reload }: { snapshot: Snapshot; etag: string; reload: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(snapshot.data, snapshot.monthlyExpensesCents))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [calculation, setCalculation] = useState<Calculation | null>(snapshot.calculation)
  const [suggestion, setSuggestion] = useState(snapshot.suggestedDownPayment || null)
  const [section, setSection] = useState(0)
  useNavigationGuard(dirty ? "Descartar os parâmetros comerciais não salvos?" : null)
  function change(next: Draft) { setDraft(next); setDirty(true); setCalculation(null); setSuggestion(null); setError(""); setNotice("") }
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
      if (save) { setDirty(false); setNotice("Parâmetros salvos. A tabela de preços ainda não foi publicada."); reload() } else { setCalculation(result.calculation); setSuggestion(result.suggestedDownPayment || null) }
    } catch (reason) { if (save) setBlocked(true); setError(reason instanceof Error ? reason.message : "Falha na operação") }
    finally { setBusy(false) }
  }
  return <form noValidate className="min-w-0 space-y-3 [--workspace-control-height:36px]" data-commercial-dirty={dirty} onSubmit={submit}>
    {notice && <p role="status">{notice}</p>}
    {!snapshot.data && <p role="status">Esta linha ainda não tem parâmetros. Informe as alíquotas da empresa.</p>}
    <nav aria-label="Seções dos parâmetros comerciais" className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{["Política comercial", "Tributos", "Canal de venda", "Provisões e despesas", "ICMS por UF"].map((label, index) => <Button key={label} type="button" size="sm" variant={section === index ? "default" : "outline"} aria-label={label} aria-pressed={section === index} aria-controls={`commercial-section-${index}`} className="h-9 min-w-0 whitespace-normal px-2 text-xs leading-4" onClick={() => setSection(index)}>{["Política", "Tributos", "Canal de venda", "Provisões", "ICMS por UF"][index]}</Button>)}</nav>
    <fieldset disabled={busy || blocked || !snapshot.canEdit} className="min-w-0 space-y-3">
      {fieldGroups.map((group, index) => <section id={`commercial-section-${index}`} hidden={section !== index} className="form-section min-w-0 space-y-3" key={group.title}><h2 className="font-semibold">{group.title}</h2><div className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 lg:grid-cols-3">{index === 0 && <label className="grid min-w-0 content-end gap-1 text-xs leading-4">UF de origem<select required className="h-9 min-w-0 rounded-lg border bg-background px-2" value={draft.originState} onChange={e => change({ ...draft, originState: e.target.value })}><option value="">Selecione</option>{states.map(state => <option key={state}>{state}</option>)}</select></label>}{group.fields.map(([key, label, unit]) => <label key={key} className="grid min-w-0 content-end gap-1 text-xs leading-4">{label} ({unit === "percent" ? "%" : unit === "money" ? "R$" : "dias"})<Input className="h-9 px-2 py-1" required readOnly={key === "monthlyExpensesCents"} inputMode={unit === "days" ? "numeric" : "decimal"} value={draft[key]} onChange={e => change({ ...draft, [key]: e.target.value })} /></label>)}</div>{group.title === "Provisões e despesas" && <p className="text-xs text-muted-foreground">Total dos cadastros vigentes. <Link className="text-primary underline" href="/preferencias/despesas-fixas">Gerenciar despesas fixas</Link></p>}</section>)}
      <section id="commercial-section-4" hidden={section !== 4} className="form-section min-w-0 space-y-3"><h2 className="font-semibold">ICMS por UF de destino</h2><p id="state-rates-help" className="text-xs text-muted-foreground">Valores em %. Saída em branco usa a alíquota interestadual padrão. Zero é um valor explícito.</p><div className="workspace-list-scroll max-h-[28rem] overflow-y-auto" role="region" aria-label="Tabela de alíquotas" tabIndex={0}><DataTable aria-label="Alíquotas por UF de destino" aria-describedby="state-rates-help" className="min-w-[440px]"><thead className="sticky top-0 z-10 bg-background"><tr><th scope="col">UF</th><th scope="col">Interno (%)</th><th scope="col">FCP (%)</th><th scope="col">Saída (%)</th></tr></thead><tbody>{draft.stateRates.map((row, index) => <tr key={row.state}><th scope="row">{row.state}</th>{([ ["internalBps", "Interno"], ["fcpBps", "FCP"], ["outgoingBps", "Saída"] ] as const).map(([key, label]) => <td key={key}><Input className="h-9 px-2 py-1" aria-label={`${row.state} ${label}`} required={key !== "outgoingBps"} inputMode="decimal" value={row[key]} onChange={e => change({ ...draft, stateRates: draft.stateRates.map((item, position) => position === index ? { ...item, [key]: e.target.value } : item) })} /></td>)}</tr>)}</tbody></DataTable></div></section>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3"><Button type="submit" size="sm" className="h-9 px-3" value="preview" variant="outline" disabled={busy}>Simular</Button><Button type="submit" size="sm" className="h-9 px-3" value="save" disabled={!dirty || busy}>Salvar parâmetros</Button>{dirty && <span className="text-xs text-muted-foreground">Alterações não salvas</span>}</div>
    </fieldset>
    {error && <p role="alert">{error}. Sua edição foi preservada.</p>}
    {blocked && <Button type="button" onClick={() => { if (window.confirm("Descartar edição e recarregar?")) { setDirty(false); reload() } }}>Recarregar</Button>}
    {calculation && <section className="form-section min-w-0 space-y-3" aria-label="Resultado gerencial"><h2 className="font-semibold">Resultado gerencial</h2>
      <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 lg:grid-cols-4">{[
        ["Preço de tabela", `custo ajustado × ${calculation.tableCostMultiplier.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`],
        ["Markup", `${calculation.markupPercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`],
        ["Pior destino", `${calculation.worstState}, ${calculation.worstNonContributor ? "não contribuinte" : "contribuinte"} · ICMS ${(calculation.worstIcmsBps / 100).toLocaleString("pt-BR")}%`],
        ["Tributos, taxas e provisões", `${(calculation.variableCostsBps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`],
        ["Lucro antes do IR necessário", `${calculation.requiredPretaxMarginPercent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`],
        ["Venda com desconto", `custo ajustado × ${calculation.discountedCostMultiplier.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`],
        ["Despesas fixas por mês", (calculation.monthlyExpensesCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })],
        ["Faturamento de equilíbrio", calculation.breakEvenRevenue == null ? "Sem equilíbrio nesta condição" : calculation.breakEvenRevenue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })],
      ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs leading-4 text-muted-foreground">{label}</dt><dd className="mt-0.5 font-medium leading-5 [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
      <details className="text-xs"><summary className="cursor-pointer py-1 font-medium text-primary">Como o preço é calculado</summary><p className="mt-1 text-muted-foreground">Venda com desconto = custo ajustado ÷ (1 − tributos, taxas e provisões − lucro antes do IR). A tabela considera o desconto livre. Para atualizar os preços publicados, prepare e confirme uma nova versão.</p></details>
      {suggestion && <div className="space-y-2 rounded-lg border p-3"><h3 className="font-semibold">Entrada mínima sugerida: {(suggestion.recommendedBps / 100).toLocaleString("pt-BR")}%</h3><p className="text-xs [overflow-wrap:anywhere]">Pior produto: {suggestion.worstSku}. Necessidade no desconto livre: {(suggestion.exactBps / 100).toLocaleString("pt-BR")}% → arredondada para cima a cada 5 pontos percentuais.</p>{suggestion.canApply ? <Button type="button" size="sm" className="h-9 max-w-full whitespace-normal px-3" variant="outline" disabled={busy || blocked} onClick={() => { change({ ...draft, minimumDownPaymentBps: String(suggestion.recommendedBps / 100).replace(".", ",") }); setNotice("Sugestão aplicada à edição. Salve os parâmetros para confirmar.") }}>Usar entrada sugerida</Button> : <p role="alert">A necessidade supera 100% da venda. Revise custos e política antes de adotar uma entrada.</p>}</div>}
    </section>}
  </form>
}
