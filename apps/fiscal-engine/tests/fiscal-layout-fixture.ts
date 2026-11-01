import type { NfeInput } from "@/lib/fiscal/nfe";

/** Fictitious same-state sale, only for local layout checks. */
export function layoutInvoice(): NfeInput {
  return {
    environment: "homologacao", series: 1, number: 123, randomCode: "48291736", issuedAt: "2026-10-17T10:00:00-03:00",
    freightMode: "1", transport: { carrier: null, volumes: null, volumeKind: null, netWeight: null, grossWeight: null }, delivery: null,
    issuer: {
      cnpj: "12345678000195", legalName: "EMITENTE FICTICIO", stateRegistration: "110042490114", taxRegime: 1,
      street: "Rua de Teste", number: "100", district: "Centro", cityCode: "3549805", city: "São José do Rio Preto", uf: "SP", cep: "15035000",
    },
    recipient: {
      kind: "PJ", document: "11222333000181", name: "CLIENTE FICTICIO", stateRegistration: null, taxpayer: false,
      street: "Rua de Teste", number: "200", complement: null, district: "Centro", cityCode: "3549805", city: "São José do Rio Preto", uf: "SP", cep: "15035000", email: "cliente@exemplo.test",
    },
    rules: {
      operationNature: "Venda de mercadoria", cfopInternal: "5102", cfopInterstate: "6102", cfopInterstateNonTaxpayer: "6108", icmsCode: "102",
      ipiCst: null, ipiFrameCode: "999", pisCst: "04", pisRate: 0, cofinsCst: "04", cofinsRate: 0, finalConsumer: true,
      ipiInIcmsBase: true, icmsOutOfContributions: true, additionalInfo: null, ibsCbs: null,
    },
    items: [{ code: "TEST-01", name: "Equipamento fictício", ncm: "95069100", cest: null, origin: 0, unit: "UN", quantity: 1, unitPrice: 100, ipiRate: 0 }],
    icmsRate: 0, destination: { internalIcms: 0.18, fcp: 0 }, payments: [{ code: "17", description: null, amount: 100 }], software: "ERP Teste",
  };
}
