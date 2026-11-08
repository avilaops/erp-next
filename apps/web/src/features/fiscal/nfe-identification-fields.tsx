"use client"

import { Input } from "@/components/ui/input"
import type { DraftInput } from "./nfe-draft-model"
import { blankExportation, withoutExportFields } from "./nfe-export-fields"

export const presenceOptions = [[0, "Não se aplica"], [1, "Operação presencial"], [2, "Operação não presencial, pela Internet"], [3, "Operação não presencial, teleatendimento"], [4, "Operação não presencial com entrega"], [5, "Operação presencial fora do estabelecimento"], [9, "Operação não presencial, outros"]] as const
export const regimeNames: Record<number, string> = { 1: "Simples Nacional", 2: "Simples Nacional com excesso de sublimite", 3: "Regime normal", 4: "MEI" }

export function localFiscalDate(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return ""
  return new Date(Date.parse(value) - 3 * 3600_000).toISOString().slice(0, 16)
}
export function fiscalDate(value: string) { return value ? `${value}:00-03:00` : null }

export function NfeIdentificationFields({ draft, change, profile, number, onImport }: {
  draft: DraftInput; change: (patch: Partial<DraftInput>) => void;
  profile?: { crt?: number | null; series?: number | null } | null; number?: number; onImport: () => void;
}) {
  const select = "h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm"
  return <>
    <label className="grid gap-2 text-sm">Tipo de saída<select aria-label="Tipo de saída" className={select} disabled={!!draft.sourceOrderId || number !== undefined} value={draft.exportation ? "export" : draft.model === 65 ? "nfce" : draft.printType === 6 ? "simplified" : "own"} onChange={e => {
      if (e.target.value === "xml") { onImport(); return }
      if (e.target.value === "export") {
        change({ model: 55, purpose: 1, creditType: null, debitType: null, printType: 1, simplifiedDanfe: null, referencedAccessKeys: [], returnDirection: undefined, sourceReturnId: undefined, sourceReturnKind: undefined, exportation: blankExportation(), items: withoutExportFields(draft.items), recipient: { ...draft.recipient, taxId: "", state: "EX", municipalityCode: "9999999", postalCode: "", foreignId: "", countryCode: null, countryName: null } }); return
      }
      if (e.target.value === "simplified") { change({ model: 55, purpose: 1, creditType: null, debitType: null, printType: 6, exportation: null, items: withoutExportFields(draft.items), finalConsumer: true, presenceIndicator: [1, 4, 5].includes(draft.presenceIndicator ?? 9) ? draft.presenceIndicator : 1, departureAt: null, referencedAccessKeys: [], returnDirection: undefined, sourceReturnId: undefined, sourceReturnKind: undefined, freightMode: "9", transport: null, installments: [], ...(draft.taxDeclaration ? { taxDeclaration: { ...draft.taxDeclaration, finalConsumer: true } } : {}), ...(draft.recipient.state === "EX" ? { recipient: { ...draft.recipient, state: "", municipalityCode: "", foreignId: null, countryCode: null, countryName: null } } : {}), simplifiedDanfe: draft.simplifiedDanfe || { qrCodeUrl: "", accessKeyUrl: "" } }); return }
      const model = e.target.value === "nfce" ? 65 : 55
      change({ model, exportation: null, items: withoutExportFields(draft.items), simplifiedDanfe: null, ...(draft.recipient.state === "EX" ? { recipient: { ...draft.recipient, state: "", municipalityCode: "", foreignId: null, countryCode: null, countryName: null } } : {}), printType: model === 65 ? 4 : 1, emissionType: undefined, ...(model === 65 ? { purpose: 1, creditType: null, debitType: null, finalConsumer: true, presenceIndicator: [1, 4, 5].includes(draft.presenceIndicator ?? 9) ? draft.presenceIndicator : 1, departureAt: null, returnDirection: undefined, referencedAccessKeys: [], sourceReturnId: undefined, sourceReturnKind: undefined, ...(draft.taxDeclaration ? { taxDeclaration: { ...draft.taxDeclaration, finalConsumer: true } } : {}) } : {}) })
    }}><option value="own">Emissão própria (NF-e)</option><option value="simplified">NF-e com DANFE Simplificado Tipo 2</option><option value="export">Exportação</option><option value="xml">Importação de XML autorizado</option><option value="nfce">NFC-e</option></select></label>
    <div className="grid grid-cols-2 gap-3"><label className="grid gap-2 text-sm">Série<Input aria-label="Série" type="number" min={1} max={999} step={1} readOnly={number !== undefined} value={draft.series ?? profile?.series ?? ""} placeholder="Informe a série" onChange={e => change({ series: e.target.value === "" ? null : Number(e.target.value) })} /></label><label className="grid gap-2 text-sm">Número<Input aria-label="Número fiscal" type="number" min={1} max={999999999} step={1} readOnly={number !== undefined} value={number ?? draft.number ?? ""} placeholder="Automático se não informado" onChange={e => change({ number: e.target.value === "" ? null : Number(e.target.value) })} /></label></div>
    <label className="grid gap-2 text-sm">Código do regime tributário<select aria-label="Código do regime tributário" className={select} value={draft.crt ?? profile?.crt ?? ""} onChange={e => change({ crt: e.target.value === "" ? null : Number(e.target.value) })}><option value="">Selecione o regime tributário</option>{Object.entries(regimeNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
    <label className="grid gap-2 text-sm">Data e hora de emissão<Input aria-label="Data e hora de emissão" type="datetime-local" readOnly={number !== undefined} value={localFiscalDate(draft.issuedAt)} onChange={e => change({ issuedAt: fiscalDate(e.target.value) })} /></label>
    {draft.model === 55 && draft.printType !== 6 && <label className="grid gap-2 text-sm">Data e hora de saída<Input aria-label="Data e hora de saída" type="datetime-local" min={localFiscalDate(draft.issuedAt) || undefined} value={localFiscalDate(draft.departureAt)} onChange={e => change({ departureAt: fiscalDate(e.target.value) })} /></label>}
    <label className="grid gap-2 text-sm">Indicador de presença<select aria-label="Indicador de presença" className={select} value={draft.presenceIndicator ?? 9} onChange={e => change({ presenceIndicator: Number(e.target.value) })}>{presenceOptions.map(([value, name]) => <option key={value} value={value} disabled={(draft.model === 65 || draft.printType === 6) && ![1, 4, 5].includes(value)}>{value}: {name}</option>)}</select></label>
    {draft.model === 55 && draft.printType !== 6 && <label className="grid gap-2 text-sm">Formato do DANFE<select aria-label="Formato do DANFE" className={select} value={draft.printType ?? 1} onChange={e => change({ printType: Number(e.target.value) })}><option value={1}>Normal, retrato</option><option value={2}>Normal, paisagem</option></select></label>}
    {draft.printType === 6 && <div className="grid gap-3 rounded-lg border p-3 sm:col-span-2 sm:grid-cols-2"><p className="text-sm font-medium sm:col-span-2">DANFE Simplificado Tipo 2, QR Code versão 3</p>{([["qrCodeUrl", "URL oficial de consulta por QR Code"], ["accessKeyUrl", "URL oficial de consulta por chave"]] as const).map(([key, label]) => <label key={key} className="grid gap-2 text-sm">{label}<Input required type="url" maxLength={300} placeholder="https://...gov.br/..." value={draft.simplifiedDanfe?.[key] || ""} onChange={e => change({ simplifiedDanfe: { qrCodeUrl: draft.simplifiedDanfe?.qrCodeUrl || "", accessKeyUrl: draft.simplifiedDanfe?.accessKeyUrl || "", [key]: e.target.value } })} /></label>)}<p className="text-xs text-muted-foreground sm:col-span-2">Informe os endereços publicados pela UF do emitente para NF-e, no ambiente desta nota. A impressão será em formato térmico.</p></div>}
    <p className="text-xs text-muted-foreground sm:col-span-2">Horários de Brasília (UTC-03). Confira série, número e regime desta nota. Deixe o número vazio para usar a sequência automática.</p>
  </>
}
