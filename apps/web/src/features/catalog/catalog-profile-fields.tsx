"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { CatalogProfileInput } from "./catalog-profile-model"

export function CatalogProfileFields({ draft, disabled, onChange }: { draft: CatalogProfileInput; disabled: boolean; onChange: (value: CatalogProfileInput) => void }) {
  const [sourcesOpen, setSourcesOpen] = useState(false)
  return <fieldset disabled={disabled} className="min-w-0 space-y-3">
    <legend className="sr-only">Dados técnicos do equipamento</legend>
    <div className="grid min-w-0 grid-cols-2 gap-3">
      {([["manufacturer", "Fabricante", 80], ["manufacturerModel", "Modelo do fabricante", 80], ["catalogProductName", "Nome no catálogo", 200], ["muscleGroup", "Grupo corporal", 80], ["technicalCategory", "Categoria técnica", 80], ["weight", "Peso do equipamento (kg)", 80], ["weightStack", "Bateria de pesos", 80], ["liveArea", "Área de treino publicada", 200]] as const).map(([field, label, maxLength]) => <label key={field} className={`grid min-w-0 gap-1 text-sm ${field === "catalogProductName" ? "col-span-2" : ""}`}>{label}<Input className="min-w-0" value={draft[field]} maxLength={maxLength} required={field === "muscleGroup" || field === "technicalCategory"} onChange={event => onChange({ ...draft, [field]: event.target.value })} /></label>)}
      <label className="grid min-w-0 gap-1 text-sm">Linha<select className="h-9 min-w-0 w-full rounded-lg border bg-background px-2" value={draft.collection} onChange={event => onChange({ ...draft, collection: event.target.value })}><option value="core">Ludus Core</option><option value="premium">Ludus Premium</option></select></label>
    </div>
    <div className="grid min-w-0 grid-cols-3 gap-2">{["Comprimento", "Largura", "Altura"].map((label, index) => <label key={label} className="grid min-w-0 gap-1 text-sm">{label} (mm)<Input className="min-w-0 px-2" type="number" inputMode="numeric" min={1} max={50000} step={1} required value={draft.dimensionsMm[index] || ""} onChange={event => onChange({ ...draft, dimensionsMm: draft.dimensionsMm.map((value, current) => current === index ? Number(event.target.value) : value) })} /></label>)}</div>
    <label className="grid min-w-0 gap-1 text-sm">Descrição<textarea className="min-w-0 w-full rounded-lg border border-input bg-background p-2 text-base" rows={4} maxLength={4000} value={draft.description} onChange={event => onChange({ ...draft, description: event.target.value })} /></label>
    <div className="min-w-0 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" className="text-sm font-medium" aria-expanded={sourcesOpen} onClick={() => setSourcesOpen(value => !value)}>Fontes do catálogo ({draft.catalogSources.length})</button><Button type="button" variant="outline" size="sm" disabled={draft.catalogSources.length >= 10} onClick={() => { setSourcesOpen(true); onChange({ ...draft, catalogSources: [...draft.catalogSources, { title: "", url: "", pdfPage: null, printedPage: null }] }) }}>Adicionar fonte</Button></div>
      {sourcesOpen && <div className="mt-3 space-y-3">{draft.catalogSources.map((source, index) => <fieldset key={index} className="grid min-w-0 grid-cols-2 gap-2 border-t pt-3">
        <legend className="px-1 text-xs text-muted-foreground">Fonte {index + 1}</legend>
        {([["title", `Título da fonte ${index + 1}`, 160], ["url", `URL da fonte ${index + 1}`, 2048]] as const).map(([field, label, maxLength]) => <label key={field} className="col-span-2 grid min-w-0 gap-1 text-sm">{label}<Input className="min-w-0" type={field === "url" ? "url" : "text"} required maxLength={maxLength} value={source[field]} onChange={event => onChange({ ...draft, catalogSources: draft.catalogSources.map((entry, current) => current === index ? { ...entry, [field]: event.target.value } : entry) })} /></label>)}
        {([["pdfPage", `Página PDF da fonte ${index + 1}`], ["printedPage", `Página impressa da fonte ${index + 1}`]] as const).map(([field, label]) => <label key={field} className="grid min-w-0 gap-1 text-sm">{label}<Input className="min-w-0" type="number" min={1} max={10000} step={1} value={source[field] ?? ""} onChange={event => onChange({ ...draft, catalogSources: draft.catalogSources.map((entry, current) => current === index ? { ...entry, [field]: event.target.value ? Number(event.target.value) : null } : entry) })} /></label>)}
        <Button className="col-span-2 justify-self-end" type="button" variant="outline" size="sm" onClick={() => onChange({ ...draft, catalogSources: draft.catalogSources.filter((_, current) => current !== index) })}>Remover fonte {index + 1}</Button>
      </fieldset>)}</div>}
    </div>
  </fieldset>
}
