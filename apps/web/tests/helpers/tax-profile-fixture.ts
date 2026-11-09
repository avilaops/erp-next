import type { TaxProfile } from "../../src/features/fiscal/settings/tax-profile-model"

export const declaredProfiles = (): TaxProfile[] => [
  {
    name: "Venda de mercadorias importadas",
    operationNature: "Venda de Mercadoria Importada",
    pisRate: "1.6500",
    cofinsRate: "7.6000",
    ibsCbsCst: "000",
    classCode: "000001",
    active: true,
    defaults: {
      icmsCst: "00",
      pisCst: "01",
      cofinsCst: "01",
      ipiCst: "50",
      ipiFrameCode: "999",
      ibsStateRate: "0.1000",
      ibsCityRate: "0.0000",
      cbsRate: "0.9000",
      finalConsumer: true
    }
  },
  {
    name: "Venda de mercadorias adquiridas no Brasil",
    operationNature: "Venda de Mercadoria Nacional",
    pisRate: "1.6500",
    cofinsRate: "7.6000",
    ibsCbsCst: "000",
    classCode: "000001",
    active: true,
    defaults: {
      icmsCst: "00",
      pisCst: "01",
      cofinsCst: "01",
      ipiCst: "53",
      ipiFrameCode: "999",
      ibsStateRate: "0.1000",
      ibsCityRate: "0.0000",
      cbsRate: "0.9000",
      finalConsumer: true
    }
  }
]
