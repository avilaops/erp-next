"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { DraftInput, DraftItem, ExportDetail, Exportation } from "./nfe-draft-model"

const states = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ")
const select = "h-10 w-full rounded-lg border bg-background px-3 text-sm"
export const blankExportation = (kind = "direct"): Exportation => ({ kind, exitState: null, exportLocation: null, dispatchLocation: null })
export const blankExportDetail = (): ExportDetail => ({ drawbackNumber: null, exportRegistration: null, referencedAccessKey: null, exportedQuantity: null })
export const withoutExportFields = (items: DraftItem[]): DraftItem[] => items.map(item => ({ ...item, taxableUnit: null, taxableQuantity: null, taxableUnitPrice: null, exportDetails: [], referencedDfe: null }))

export function NfeExportFields({ draft, change }: { draft: DraftInput; change: (patch: Partial<DraftInput>) => void }) {
  const value = draft.exportation
  if (!value) return null
  const foreign = value.kind !== "trading"
  return <section className="form-section space-y-4" aria-label="Exportação">
    <h2 className="text-lg font-semibold">Exportação</h2>
    <label className="grid gap-2 text-sm">Modalidade de exportação<select aria-label="Modalidade de exportação" className={select} value={value.kind} onChange={event => {
      const kind = event.target.value, exterior = kind !== "trading"
      change({ exportation: { ...value, kind, ...(exterior ? {} : { exitState: null, exportLocation: null, dispatchLocation: null }) }, ...(!exterior ? { items: withoutExportFields(draft.items) } : {}), recipient: { ...draft.recipient, ...(exterior ? { taxId: "", state: "EX", municipalityCode: "9999999", postalCode: "", foreignId: draft.recipient.foreignId ?? "" } : { state: "", municipalityCode: "", foreignId: null, countryCode: null, countryName: null }) } })
    }}><option value="direct">Exportação direta ao exterior</option><option value="trading">Venda para trading ou exportadora no Brasil</option><option value="indirect">Exportação indireta com notas de origem</option></select></label>
    {foreign ? <div className="grid gap-3 sm:grid-cols-3">
      <label className="grid gap-2 text-sm">UF de saída do país<select aria-label="UF de saída do país" required className={select} value={value.exitState || ""} onChange={e => change({ exportation: { ...value, exitState: e.target.value || null } })}><option value="">Selecione</option>{states.map(state => <option key={state}>{state}</option>)}</select></label>
      <label className="grid gap-2 text-sm">Local de embarque ou transposição<Input required maxLength={60} value={value.exportLocation || ""} onChange={e => change({ exportation: { ...value, exportLocation: e.target.value || null } })} /></label>
      <label className="grid gap-2 text-sm">Local de despacho<Input maxLength={60} value={value.dispatchLocation || ""} onChange={e => change({ exportation: { ...value, dispatchLocation: e.target.value || null } })} /></label>
    </div> : <p className="text-sm text-muted-foreground">Use o destinatário brasileiro e o CFOP da venda com fim específico de exportação conforme a instrução fiscal.</p>}
    {foreign && <p className="text-xs text-muted-foreground">Informe país e endereço estrangeiro no destinatário, unidade tributável de exportação nos itens e a classificação fiscal da operação na etapa Tributação.</p>}
  </section>
}

export function NfeForeignRecipientFields({ draft, change }: { draft: DraftInput; change: (patch: Partial<DraftInput>) => void }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{([
    ["legalName", "Nome do destinatário", 60, true], ["foreignId", "Identificação no exterior", 20, false],
    ["countryCode", "Código do país (BACEN)", 4, true], ["countryName", "País", 60, true], ["cityName", "Cidade no exterior", 60, true],
    ["street", "Logradouro", 60, true], ["number", "Número", 60, true], ["district", "Bairro ou distrito", 60, true],
    ["complement", "Complemento", 60, false], ["phone", "Telefone", 14, false], ["email", "E-mail", 60, false],
  ] as const).map(([key, label, maxLength, required]) => <label key={key} className="grid gap-2 text-sm">{label}<Input required={required} type={key === "email" ? "email" : "text"} maxLength={maxLength} value={draft.recipient[key] || ""} onChange={e => change({ recipient: { ...draft.recipient, [key]: e.target.value || (required || key === "foreignId" ? "" : null) } })} /></label>)}</div>
}

export function NfeExportItemFields({ item, index, kind, change }: { item: DraftItem; index: number; kind: string; change: (patch: Partial<DraftItem>) => void }) {
  if (kind === "trading") return null
  const details = item.exportDetails || []
  return <div className="mt-4 space-y-3 border-t pt-3">
    <h3 className="text-sm font-medium">Exportação do item {index + 1}</h3>
    <div className="grid gap-3 sm:grid-cols-3">{([["taxableUnit", "Unidade tributável de exportação", 6], ["taxableQuantity", "Quantidade tributável", 16], ["taxableUnitPrice", "Preço unitário tributável", 22]] as const).map(([key, label, maxLength]) => <label key={key} className="grid gap-2 text-xs">{label}<Input required maxLength={maxLength} inputMode={key === "taxableUnit" ? "text" : "decimal"} value={item[key] || ""} onChange={e => change({ [key]: e.target.value || null })} /></label>)}</div>
    <p className="text-xs text-muted-foreground">Use a unidade tributável exigida pelo NCM e confira a conversão com a quantidade comercial.</p>
    {details.map((detail, position) => <div key={position} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">{([
      ["drawbackNumber", "Número do drawback", 20, false], ["exportRegistration", "Registro de exportação (RE)", 12, false],
      ["referencedAccessKey", "Chave da NF-e de origem", 44, kind === "indirect"], ["exportedQuantity", "Quantidade comercial exportada", 16, kind === "indirect"],
    ] as const).map(([key, label, maxLength, required]) => <label key={key} className="grid gap-2 text-xs">{label}<Input required={required} maxLength={maxLength} value={detail[key] ?? ""} onChange={e => change({ exportDetails: details.map((current, at) => at === position ? { ...current, [key]: e.target.value || (key === "exportRegistration" ? "" : null) } : current) })} /></label>)}<Button type="button" variant="ghost" onClick={() => change({ exportDetails: details.filter((_, at) => at !== position) })}>Remover origem {position + 1}</Button></div>)}
    <Button type="button" variant="outline" disabled={details.length >= 500} onClick={() => change({ exportDetails: [...details, { ...blankExportDetail(), exportRegistration: kind === "indirect" ? "" : null }] })}>Adicionar origem ou drawback</Button>
    {kind === "indirect" && !details.length && <p className="text-xs text-muted-foreground">Adicione as notas de origem e a quantidade exportada. RE pode ficar vazio nas operações com DU-E.</p>}
  </div>
}
