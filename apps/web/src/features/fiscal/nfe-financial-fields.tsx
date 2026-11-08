"use client"

import { Input } from "@/components/ui/input"
import type { DraftInput, DraftItem } from "./nfe-draft-model"

const creditTypes = [
  ["01", "Multa e juros", true],
  ["02", "Crédito presumido de IBS sobre saldo devedor na ZFM", false],
  ["03", "Retorno por recusa total ou destinatário não localizado", true],
  ["04", "Redução de valores", true],
  ["05", "Transferência de crédito na sucessão", false],
  ["06", "Retorno por recusa parcial na entrega", true],
] as const
const debitTypes = [
  ["01", "Transferência de créditos para cooperativas", false],
  ["02", "Anulação de crédito por saídas imunes ou isentas", false],
  ["03", "Débitos de notas não processadas na apuração", true],
  ["04", "Multa e juros", true],
  ["05", "Transferência de crédito na sucessão", false],
  ["06", "Pagamento antecipado", true],
  ["07", "Perda em estoque", false],
  ["08", "Desenquadramento do Simples Nacional", false],
] as const

export function hasItemFiscalReference(draft: DraftInput) {
  return draft.purpose === 5 && draft.creditType === "06" || draft.purpose === 6 && ["03", "04"].includes(draft.debitType || "")
}
export function hasHeaderFiscalReference(draft: DraftInput) {
  return [2, 3].includes(draft.purpose || 1) || draft.purpose === 5 && ["01", "03", "04"].includes(draft.creditType || "")
}

export function NfeFinancialFields({ draft, change }: { draft: DraftInput; change: (patch: Partial<DraftInput>) => void }) {
  if (![5, 6].includes(draft.purpose || 1)) return null
  const credit = draft.purpose === 5
  const key = credit ? "creditType" : "debitType"
  const options = credit ? creditTypes : debitTypes
  const label = credit ? "Tipo de nota de crédito" : "Tipo de nota de débito"
  return <section className="form-section space-y-3" aria-label="Finalidade financeira da NF-e">
    <h2 className="text-lg font-semibold">{credit ? "Nota de crédito" : "Nota de débito"}</h2>
    <p className="text-sm text-muted-foreground">{credit ? "Documento fiscal de entrada para o emitente." : "Documento fiscal de saída para o emitente."}</p>
    <label className="grid gap-2 text-sm">{label}<select aria-label={label} required className="h-10 w-full rounded-lg border bg-background px-3 text-sm" value={draft[key] || ""} onChange={event => change({ [key]: event.target.value || null, referencedAccessKeys: [], items: draft.items.map(item => ({ ...item, referencedDfe: null })) })}>
      <option value="">Selecione conforme a instrução fiscal</option>
      {options.map(([code, name, supported]) => <option key={code} value={code} disabled={!supported}>{code}: {name}{supported ? "" : " (não implementado)"}</option>)}
    </select></label>
    <p className="text-xs text-muted-foreground">Disponível no regime normal (CRT 3), para operações nacionais. Informe códigos, alíquotas e documentos de origem conforme a orientação fiscal. Salvar não gera lançamento financeiro.</p>
    {hasItemFiscalReference(draft) && <p className="text-sm text-muted-foreground">Informe o documento fiscal de origem de cada item na etapa Tributação.</p>}
    {draft.purpose === 6 && draft.debitType === "06" && <p className="text-xs text-muted-foreground">Pagamento antecipado está disponível sem IPI neste pacote de schemas.</p>}
  </section>
}

export function NfeItemFiscalReference({ draft, item, index, change }: { draft: DraftInput; item: DraftItem; index: number; change: (patch: Partial<DraftItem>) => void }) {
  if (!hasItemFiscalReference(draft)) return null
  const value = item.referencedDfe
  const noItemNumber = draft.purpose === 6 && draft.debitType === "03"
  return <div className="mt-4 grid gap-3 border-t pt-3 sm:grid-cols-2">
    <label className="grid gap-2 text-sm">Chave do documento de origem do item {index + 1}<Input required maxLength={44} inputMode="numeric" value={value?.accessKey || ""} onChange={event => change({ referencedDfe: { ...value, accessKey: event.target.value } })} /></label>
    {!noItemNumber && <label className="grid gap-2 text-sm">Número do item na nota de origem<Input required type="number" min={1} max={990} step={1} value={value?.itemNumber ?? ""} onChange={event => change({ referencedDfe: { accessKey: value?.accessKey || "", itemNumber: event.target.value ? Number(event.target.value) : null } })} /></label>}
    {noItemNumber && <p className="text-xs text-muted-foreground">Débitos de notas não processadas referenciam o documento inteiro, sem número de item.</p>}
  </div>
}
