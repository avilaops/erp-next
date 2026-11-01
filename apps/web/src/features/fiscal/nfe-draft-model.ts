export type DraftItem = {
  code: string; description: string; unit: string; ncm: string; cfop: string
  quantity: string; unitPrice: string; grossTotal: string; origin: number
  icmsCst: string | null; csosn: string | null; pisCst: string; cofinsCst: string
}
export type TaxDeclaration = {
  recipientTaxpayer: boolean | null; recipientStateRegistration: string | null; finalConsumer: boolean | null
  icmsRate: string | null; pisRate: string | null; cofinsRate: string | null
  ipiCst: string | null; ipiFrameCode: string | null; ipiRate: string | null
  ipiInIcmsBase: boolean | null; icmsOutOfContributions: boolean | null
  ibsCbs: { cst: string; classCode: string; ibsStateRate: string; ibsCityRate: string; cbsRate: string }
}
export type DraftInput = {
  sourceOrderId?: string
  environment: "homologation"; model: 55; operationNature: string; taxRuleReference: string
  recipient: { taxId: string; legalName: string; state: string; municipalityCode: string; postalCode: string; street: string; number: string; district: string }
  items: DraftItem[]; productsTotal: string
  payments?: { code: string; description: string | null; amount: string }[]
  taxDeclaration?: TaxDeclaration
}
export type NfeDraft = {
  id: string; revision: number; status: "draft"; input: DraftInput; productsTotal: string; fiscalValidationComplete: false
  issuer: { taxId: string; legalName: string; companyRevision: number; profileRevision: number; profile: { state: string; crt: number; series: number } }
}
export type FiscalReadiness = { tenantId: string; profileConfigured: boolean; certificateVerified: boolean; canTransmit: boolean; productionEnabled: false; blockers: string[] }

export const blankItem = (): DraftItem => ({ code: "", description: "", unit: "", ncm: "", cfop: "", quantity: "1.0000", unitPrice: "", grossTotal: "0.00", origin: -1, icmsCst: null, csosn: null, pisCst: "", cofinsCst: "" })
export const blankDraft = (): DraftInput => ({ environment: "homologation", model: 55, operationNature: "", taxRuleReference: "", recipient: { taxId: "", legalName: "", state: "", municipalityCode: "", postalCode: "", street: "", number: "", district: "" }, items: [blankItem()], productsTotal: "0.00" })
export const blankTaxDeclaration = (): TaxDeclaration => ({ recipientTaxpayer: null, recipientStateRegistration: null, finalConsumer: null, icmsRate: null, pisRate: null, cofinsRate: null, ipiCst: null, ipiFrameCode: null, ipiRate: null, ipiInIcmsBase: null, icmsOutOfContributions: null, ibsCbs: { cst: "", classCode: "", ibsStateRate: "", ibsCityRate: "", cbsRate: "" } })

export function fixed(value: string, scale: number, wholeDigits: number): string {
  const match = /^(\d+)(?:[.,](\d+))?$/.exec(value.trim())
  if (!match || (match[2]?.length ?? 0) > scale) throw new Error(`Informe um decimal positivo com até ${scale} casas`)
  const whole = BigInt(match[1]).toString()
  if (whole.length > wholeDigits) throw new Error("Valor acima do limite fiscal")
  return `${whole}.${(match[2] || "").padEnd(scale, "0")}`
}
const scaled = (value: string) => BigInt(value.replace(".", ""))
const cents = (value: bigint) => `${value / BigInt(100)}.${(value % BigInt(100)).toString().padStart(2, "0")}`

export function itemTotal(quantity: string, price: string): string {
  return cents((scaled(fixed(quantity, 4, 11)) * scaled(fixed(price, 10, 11)) + BigInt(500_000_000_000)) / BigInt(1_000_000_000_000))
}

export function productsTotal(items: DraftItem[]): string {
  return cents(items.reduce((sum, item) => sum + scaled(itemTotal(item.quantity, item.unitPrice)), BigInt(0)))
}

function percent(value: string): string {
  const result = fixed(value, 4, 2)
  if (scaled(result) >= BigInt(1_000_000)) throw new Error("A alíquota percentual deve ser menor que 100")
  return result
}

export function invoiceTotal(draft: DraftInput): string {
  const ipiRate = draft.taxDeclaration?.ipiRate
  const rate = ipiRate ? scaled(percent(ipiRate)) : BigInt(0)
  return cents(draft.items.reduce((sum, item) => {
    const product = scaled(itemTotal(item.quantity, item.unitPrice))
    return sum + product + (product * rate + BigInt(500_000)) / BigInt(1_000_000)
  }, BigInt(0)))
}

function declaredTaxes(declaration: TaxDeclaration): TaxDeclaration {
  for (const field of ["recipientTaxpayer", "finalConsumer", "ipiInIcmsBase", "icmsOutOfContributions"] as const) {
    if (typeof declaration[field] !== "boolean") throw new Error("Declare contribuinte, consumidor final e composição das bases conforme a instrução fiscal")
  }
  return {
    ...declaration,
    icmsRate: declaration.icmsRate ? percent(declaration.icmsRate) : null,
    pisRate: declaration.pisRate ? percent(declaration.pisRate) : null,
    cofinsRate: declaration.cofinsRate ? percent(declaration.cofinsRate) : null,
    ipiRate: declaration.ipiRate ? percent(declaration.ipiRate) : null,
    ibsCbs: { ...declaration.ibsCbs, ibsStateRate: percent(declaration.ibsCbs.ibsStateRate), ibsCityRate: percent(declaration.ibsCbs.ibsCityRate), cbsRate: percent(declaration.ibsCbs.cbsRate) },
  }
}

export function submission(draft: DraftInput): DraftInput {
  const items = draft.items.map((item, index) => {
    if (item.origin < 0) throw new Error(`Informe a origem da mercadoria no item ${index + 1}`)
    if (!!item.icmsCst === !!item.csosn) throw new Error(`Informe CST ou CSOSN, conforme o CRT, no item ${index + 1}`)
    return { ...item, quantity: fixed(item.quantity, 4, 11), unitPrice: fixed(item.unitPrice, 10, 11), grossTotal: itemTotal(item.quantity, item.unitPrice) }
  })
  return { ...draft, items, productsTotal: productsTotal(items), ...(draft.taxDeclaration ? { taxDeclaration: declaredTaxes(draft.taxDeclaration) } : {}), ...(draft.payments ? { payments: draft.payments.map(payment => ({ ...payment, amount: fixed(payment.amount, 2, 13) })) } : {}) }
}

export const blockerLabels: Record<string, string> = {
  fiscal_engine_not_configured: "O motor fiscal ainda não foi configurado",
  homologation_emission_requires_sp: "Emissão em homologação disponível para emitente de São Paulo",
  homologation_emission_requires_supported_tax_rule_scope: "O regime fiscal da empresa exige regras além do recorte disponível",
  tax_rule_scope: "A classificação exige regras fiscais além do recorte disponível",
  payments_required: "Informe as formas de pagamento declaradas na NF-e",
  municipality_unresolved: "Confira o código IBGE e a UF",
  amount_mismatch: "Confira os totais e valores dos itens",
  certificate_invalid: "Confira a validade e o CNPJ do certificado",
  invalid_fiscal_input: "Revise os dados fiscais antes de repetir",
  current_xsd_and_tax_rules_validation_not_implemented: "Validação fiscal e pacote XSD vigente ainda não integrados",
  xml_generation_and_xmldsig_not_implemented: "Geração e assinatura do XML ainda não integradas",
  sefaz_transport_and_reconciliation_not_implemented: "Transmissão e consulta à SEFAZ ainda não integradas",
  r2_document_storage_not_implemented: "Armazenamento dos documentos de emissão ainda não integrado",
  a1_certificate_missing_expired_or_unavailable: "Conecte um certificado A1 válido para a empresa",
  company_and_fiscal_profile_inconsistent: "Confira os dados da empresa e a configuração fiscal",
  fiscal_profile_missing: "Preencha a configuração fiscal do emitente",
}
