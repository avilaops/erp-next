export type TaxProfileDefaults = {
  icmsCst?: string
  pisCst?: string
  cofinsCst?: string
  ipiCst?: string
  ipiFrameCode?: string
  ibsStateRate?: string
  ibsCityRate?: string
  cbsRate?: string
  finalConsumer?: boolean
  ipiInIcmsBase?: boolean
  icmsOutOfContributions?: boolean
}

export type TaxProfile = {
  name: string
  operationNature: string
  pisRate: string
  cofinsRate: string
  ibsCbsCst: string
  classCode: string
  active: boolean
  defaults?: TaxProfileDefaults | null
}
export const ludusProfiles = (): TaxProfile[] =>
  [
    ["Venda de mercadorias importadas", "Venda de Mercadoria Importada", "50"],
    ["Venda de mercadorias adquiridas no Brasil", "Venda de mercadoria adquirida no mercado interno", "53"]
  ].map(([name, operationNature, ipiCst]) => ({
    name,
    operationNature,
    pisRate: "1.6500",
    cofinsRate: "7.6000",
    ibsCbsCst: "000",
    classCode: "000001",
    active: true,
    defaults: {
      icmsCst: "00", pisCst: "01", cofinsCst: "01", ipiCst, ipiFrameCode: "999",
      ibsStateRate: "0.1000", ibsCityRate: "0.0000", cbsRate: "0.9000",
      finalConsumer: true, ipiInIcmsBase: true, icmsOutOfContributions: true
    }
  }))
