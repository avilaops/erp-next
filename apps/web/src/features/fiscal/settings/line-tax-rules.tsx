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
  return <div className="col-span-full space-y-4 border-t pt-4">
    <label className="grid gap-2">Linha comercial deste perfil<select aria-label={`Perfil ${index}: linha comercial`} className="min-h-10 rounded-lg border bg-background px-3" value={value.productLine || ""} onChange={e => { if (e.target.value) update({ productLine: e.target.value as TaxProfile["productLine"], lineRules: rules || blankLineRules() }); else update({ productLine: undefined, lineRules: undefined }) }}><option value="">Perfil geral, sem regras por linha</option><option value="imported">Importada</option><option value="national">Nacional</option></select></label>
    {rules && <><p className="text-sm text-muted-foreground">As alíquotas fiscais são declaradas neste perfil. A grade gerencial não substitui o enquadramento da nota. O recorte de emissão atual continua restrito à homologação e às operações suportadas.</p>
      <details className="rounded-lg border p-3"><summary>Completar CFOPs por operação</summary><div className="mt-3 grid gap-3"><label className="grid gap-2">Operação escolhida com a contabilidade<select className="min-h-10 rounded-lg border bg-background px-3" value={operation} onChange={e => setOperation(e.target.value)}><option value="">Selecione explicitamente</option><option value="production">Venda de produção do estabelecimento: 5101 / 6101</option><option value="resale">Venda de mercadoria adquirida de terceiros: 5102 / 6102</option></select></label><Button type="button" variant="outline" disabled={!operation} onClick={() => patch({ cfopSameState: rules.cfopSameState || (operation === "production" ? "5101" : "5102"), cfopInterstateTaxpayer: rules.cfopInterstateTaxpayer || (operation === "production" ? "6101" : "6102"), cfopInterstateNonTaxpayer: rules.cfopInterstateNonTaxpayer || (operation === "production" ? "6101" : "6102") })}>Completar somente CFOPs vazios</Button></div></details>
      <div className="grid gap-4 sm:grid-cols-2">{fields.map(([key, label, max]) => <label key={key} className="grid gap-2">{label}<Input required aria-label={`Perfil ${index}: ${label}`} maxLength={max} inputMode={key.endsWith("Rate") ? "decimal" : "numeric"} value={rules[key]} onChange={e => patch({ [key]: e.target.value.replace(",", ".") })} /></label>)}</div>
      {([["finalConsumer", "O cliente é consumidor final"], ["ipiInIcmsBase", "Incluir IPI na base do ICMS ao consumidor final"], ["icmsOutOfContributions", "Excluir ICMS destacado da base de PIS/COFINS"]] as const).map(([key, label]) => <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={rules[key]} onChange={e => patch({ [key]: e.target.checked })} />{label}</label>)}
      <label className="grid gap-2">Informações complementares fixas da nota<textarea className="min-h-24 rounded-lg border bg-background p-3" maxLength={5000} value={rules.additionalInformation} onChange={e => patch({ additionalInformation: e.target.value })} /></label>
    </>}
  </div>
}
