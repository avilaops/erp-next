import type { CompanyData } from "./company-types"

export const companySections = {
  identificacao: { heading: "identificacao-title", label: "Dados cadastrais" },
  endereco: { heading: "endereco-title", label: "Endereço" },
  contato: { heading: "contato-title", label: "Contatos" },
  fiscal: { heading: "fiscal-title", label: "Dados fiscais e atividade" },
  inscricoes: { heading: "substitutos-title", label: "Inscrições substitutas" },
} as const

export type CompanySection = keyof typeof companySections

export function companySectionStatus(data: CompanyData, section: CompanySection) {
  const count = (fields: (keyof CompanyData)[]) => fields.filter(field => typeof data[field] === "string" && data[field].trim()).length
  switch (section) {
    case "identificacao": return `${count(["legalName", "taxId"])} de 2 dados básicos informados`
    case "endereco": return `${count(["postalCode", "state", "city", "street", "number", "district"])} de 6 campos de endereço informados`
    case "contato": return `${count(["contactName", "phone", "mobile", "email", "billingEmail", "website"])} campos de contato informados`
    case "fiscal": return data.taxRegime.trim() ? "Regime tributário informado" : "Regime tributário não informado"
    case "inscricoes": return data.substituteRegistrations.length ? `${data.substituteRegistrations.length} inscrições substitutas informadas` : "Sem inscrições substitutas informadas"
  }
}
