"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { blankLineRules, type TaxProfile, type LineTaxRules } from "./tax-profile-model"

const fields = [
  ["cfopSameState", "CFOP dentro do estado", 4], ["cfopInterstateTaxpayer", "CFOP para contribuinte de outro estado", 4], ["cfopInterstateNonTaxpayer", "CFOP para não contribuinte de outro estado", 4],
  ["icmsCst", "CST do ICMS", 2], ["ipiCst", "CST do IPI", 2], ["ipiFrameCode", "Código de enquadramento do IPI", 3], ["pisCst", "CST do PIS", 2], ["cofinsCst", "CST da COFINS", 2],
  ["icmsRate", "Alíquota fiscal do ICMS (%)", 8], ["ipiRate", "Alíquota fiscal do IPI (%)", 8], ["ibsStateRate", "Alíquota do IBS estadual (%)", 8], ["ibsCityRate", "Alíquota do IBS municipal (%)", 8], ["cbsRate", "Alíquota da CBS (%)", 8],
] as const

export function LineTaxRulesEditor({ value, update, index }: { value: TaxProfile; update: (value: Partial<TaxProfile>) => void; index: number }) {
  const [operation, setOperation] = useState("")
  const rules = value.lineRules
  function patch(next: Partial<LineTaxRules>) { if (rules) update({ lineRules: { ...rules, ...next } }) }
  return <div className="col-span-full min-w-0 space-y-3 rounded-lg border bg-muted/20 p-3 text-xs">
    <label className="flex min-h-8 items-center gap-2 font-medium"><input className="size-4 shrink-0 accent-primary" type="checkbox" aria-label={`Perfil ${index}: definir regras fiscais por operação`} checked={Boolean(rules)} onChange={e => update({ lineRules: e.target.checked ? blankLineRules() : undefined })} />Definir regras fiscais por operação</label>
    {rules && <><p className="text-xs leading-5 text-muted-foreground">Informe a linha comercial e complete as regras para aplicar CFOPs e alíquotas por operação.</p>
      <details className="min-w-0 rounded-lg border bg-background p-3"><summary className="cursor-pointer font-medium">Completar CFOPs por operação</summary><div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"><label className="grid min-w-0 gap-1.5 font-medium">Operação escolhida com a contabilidade<select className="h-9 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm font-normal" value={operation} onChange={e => setOperation(e.target.value)}><option value="">Selecione explicitamente</option><option value="production">Venda de produção do estabelecimento: 5101 / 6101</option><option value="resale">Venda de mercadoria adquirida de terceiros: 5102 / 6102</option></select></label><Button type="button" variant="outline" className="h-9 text-xs" disabled={!operation} onClick={() => patch({ cfopSameState: rules.cfopSameState || (operation === "production" ? "5101" : "5102"), cfopInterstateTaxpayer: rules.cfopInterstateTaxpayer || (operation === "production" ? "6101" : "6102"), cfopInterstateNonTaxpayer: rules.cfopInterstateNonTaxpayer || (operation === "production" ? "6101" : "6102") })}>Completar somente CFOPs vazios</Button></div></details>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">{fields.map(([key, label, max]) => <label key={key} className="grid min-w-0 gap-1.5 font-medium">{label}<Input className="h-9 text-sm" required aria-label={`Perfil ${index}: ${label}`} maxLength={max} inputMode={key.endsWith("Rate") ? "decimal" : "numeric"} value={rules[key]} onChange={e => patch({ [key]: e.target.value.replace(",", ".") })} /></label>)}</div>
      {([["finalConsumer", "O cliente é consumidor final"], ["ipiInIcmsBase", "Incluir IPI na base do ICMS ao consumidor final"], ["icmsOutOfContributions", "Excluir ICMS destacado da base de PIS/COFINS"]] as const).map(([key, label]) => <label key={key} className="flex min-h-8 items-center gap-2"><input className="size-4 shrink-0 accent-primary" type="checkbox" checked={rules[key]} onChange={e => patch({ [key]: e.target.checked })} />{label}</label>)}
      <label className="grid min-w-0 gap-1.5 font-medium">Informações complementares fixas da nota<textarea className="min-h-20 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm font-normal" maxLength={5000} value={rules.additionalInformation} onChange={e => patch({ additionalInformation: e.target.value })} /></label>
    </>}
  </div>
}
