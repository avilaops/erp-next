export type TaxProfile = {
  name: string
  operationNature: string
  pisRate: string
  cofinsRate: string
  ibsCbsCst: string
  classCode: string
  active: boolean
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
