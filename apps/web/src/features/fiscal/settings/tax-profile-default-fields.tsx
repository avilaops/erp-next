"use client"

import { Input } from "@/components/ui/input"
import type { TaxProfileDefaults } from "./tax-profile-model"

export function TaxProfileDefaultFields({ index, value, onChange }: {
  index: number
  value: TaxProfileDefaults
  onChange: (value: TaxProfileDefaults) => void
}) {
  const codes = [
    ["icmsCst", "CST do ICMS", ["00", "40", "41", "50"]],
    ["pisCst", "CST do PIS", ["01", "02", "04", "05", "06", "07", "08", "09"]],
    ["cofinsCst", "CST da COFINS", ["01", "02", "04", "05", "06", "07", "08", "09"]],
    ["ipiCst", "CST do IPI", ["00", "49", "50", "99", "01", "02", "03", "04", "05", "51", "52", "53", "54", "55"]]
  ] as const
  return <fieldset className="grid min-w-0 gap-4 rounded-lg border p-4 sm:col-span-2 sm:grid-cols-2">
    <legend className="px-2 font-medium">Padrões adicionais para a nota</legend>
    {codes.map(([key, label, options]) => <label key={key} className="grid min-w-0 gap-2 text-sm">
      {label}
      <select aria-label={`Perfil ${index + 1}: ${label}`} className="h-10 w-full rounded-lg border bg-background px-3" value={value[key] ?? ""} onChange={event => onChange({ ...value, [key]: event.target.value || undefined })}>
        <option value="">Não preencher</option>
        {options.map(code => <option key={code} value={code}>{code}</option>)}
      </select>
    </label>)}
    <label className="grid min-w-0 gap-2 text-sm">Enquadramento do IPI
      <Input aria-label={`Perfil ${index + 1}: Enquadramento do IPI`} inputMode="numeric" maxLength={3} pattern="[0-9]{3}" value={value.ipiFrameCode ?? ""} onChange={event => onChange({ ...value, ipiFrameCode: event.target.value || undefined })} />
    </label>
    {([["ibsStateRate", "IBS estadual (%)"], ["ibsCityRate", "IBS municipal (%)"], ["cbsRate", "CBS (%)"]] as const).map(([key, label]) => <label key={key} className="grid min-w-0 gap-2 text-sm">
      {label}
      <Input aria-label={`Perfil ${index + 1}: ${label}`} inputMode="decimal" maxLength={7} pattern="[0-9]{1,2}([.][0-9]{1,4})?" value={value[key] ?? ""} onChange={event => onChange({ ...value, [key]: event.target.value.replace(",", ".") || undefined })} />
    </label>)}
    {([["finalConsumer", "Consumidor final"], ["ipiInIcmsBase", "IPI na base do ICMS para consumidor final"], ["icmsOutOfContributions", "Excluir ICMS da base de PIS/COFINS"]] as const).map(([key, label]) => <label key={key} className="grid min-w-0 gap-2 text-sm">
      {label}
      <select aria-label={`Perfil ${index + 1}: ${label}`} className="h-10 w-full rounded-lg border bg-background px-3" value={value[key] === undefined ? "" : String(value[key])} onChange={event => onChange({ ...value, [key]: event.target.value === "" ? undefined : event.target.value === "true" })}>
        <option value="">Não preencher</option><option value="true">Sim</option><option value="false">Não</option>
      </select>
    </label>)}
    <p className="text-xs text-muted-foreground sm:col-span-2">Esses padrões completam campos vazios ao aplicar o perfil. CFOP, origem, contribuinte do ICMS e alíquotas de ICMS/IPI dependem do produto e da operação.</p>
  </fieldset>
}
