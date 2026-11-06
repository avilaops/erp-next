import { normalizeDecimal } from "@/lib/decimal-input"
export type TaxProfileDefaults = { icmsCst?: string; pisCst?: string; cofinsCst?: string; ipiCst?: string; ipiFrameCode?: string; ibsStateRate?: string; ibsCityRate?: string; cbsRate?: string; finalConsumer?: boolean; ipiInIcmsBase?: boolean; icmsOutOfContributions?: boolean }

export type TaxProfile = {
  name: string
  operationNature: string
  pisRate: string
  cofinsRate: string
  ibsCbsCst: string
  classCode: string
  active: boolean
  productLine?: "imported" | "national"
  lineRules?: LineTaxRules
  defaults?: TaxProfileDefaults | null
}
export type LineTaxRules = {
  cfopSameState: string; cfopInterstateTaxpayer: string; cfopInterstateNonTaxpayer: string
  icmsCst: string; ipiCst: string; ipiFrameCode: string; pisCst: string; cofinsCst: string
  icmsRate: string; ipiRate: string; ibsStateRate: string; ibsCityRate: string; cbsRate: string
  finalConsumer: boolean; ipiInIcmsBase: boolean; icmsOutOfContributions: boolean; additionalInformation: string
}
export const blankLineRules = (): LineTaxRules => ({ cfopSameState: "", cfopInterstateTaxpayer: "", cfopInterstateNonTaxpayer: "", icmsCst: "", ipiCst: "", ipiFrameCode: "", pisCst: "", cofinsCst: "", icmsRate: "", ipiRate: "", ibsStateRate: "", ibsCityRate: "", cbsRate: "", finalConsumer: false, ipiInIcmsBase: false, icmsOutOfContributions: false, additionalInformation: "" })
export type FiscalScenario = "sameState" | "interstateTaxpayer" | "interstateNonTaxpayer"
export function normalizedProfile(profile: TaxProfile): TaxProfile {
  function rate(value: string) { const result = normalizeDecimal(value, 4); if (!result) throw Error("Alíquota inválida. Use até quatro casas decimais."); return result }
  return { ...profile, pisRate: rate(profile.pisRate), cofinsRate: rate(profile.cofinsRate), ...(profile.lineRules ? { lineRules: { ...profile.lineRules, icmsRate: rate(profile.lineRules.icmsRate), ipiRate: rate(profile.lineRules.ipiRate), ibsStateRate: rate(profile.lineRules.ibsStateRate), ibsCityRate: rate(profile.lineRules.ibsCityRate), cbsRate: rate(profile.lineRules.cbsRate) } } : {}) }
}
export const ludusProfiles = (): TaxProfile[] =>
  ["Venda de mercadorias importadas", "Venda de mercadorias adquiridas no Brasil"].map((name) => ({
    name,
    operationNature: "Venda de mercadorias",
    pisRate: "1.6500",
    cofinsRate: "7.6000",
    ibsCbsCst: "000",
    classCode: "000001",
    active: true
  }))
