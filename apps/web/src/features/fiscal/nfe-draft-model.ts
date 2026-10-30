export type DraftItem = {
  code: string; description: string; unit: string; ncm: string; cfop: string
  quantity: string; unitPrice: string; grossTotal: string; origin: number
  icmsCst: string | null; csosn: string | null; pisCst: string; cofinsCst: string
}
export type DraftInput = {
  sourceOrderId?: string
  environment: "homologation"; model: 55; operationNature: string; taxRuleReference: string
  recipient: { taxId: string; legalName: string; state: string; municipalityCode: string; postalCode: string; street: string; number: string; district: string }
  items: DraftItem[]; productsTotal: string
}
export type NfeDraft = {
  id: string; revision: number; status: "draft"; input: DraftInput; productsTotal: string; fiscalValidationComplete: false
  issuer: { taxId: string; legalName: string; companyRevision: number; profileRevision: number; profile: { state: string; crt: number; series: number } }
}
export type FiscalReadiness = { tenantId: string; profileConfigured: boolean; certificateVerified: boolean; canTransmit: false; productionEnabled: false; blockers: string[] }

export const blankItem = (): DraftItem => ({ code: "", description: "", unit: "", ncm: "", cfop: "", quantity: "1.0000", unitPrice: "", grossTotal: "0.00", origin: -1, icmsCst: null, csosn: null, pisCst: "", cofinsCst: "" })
export const blankDraft = (): DraftInput => ({ environment: "homologation", model: 55, operationNature: "", taxRuleReference: "", recipient: { taxId: "", legalName: "", state: "", municipalityCode: "", postalCode: "", street: "", number: "", district: "" }, items: [blankItem()], productsTotal: "0.00" })

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

export function submission(draft: DraftInput): DraftInput {
  const items = draft.items.map((item, index) => {
    if (item.origin < 0) throw new Error(`Informe a origem da mercadoria no item ${index + 1}`)
    if (!!item.icmsCst === !!item.csosn) throw new Error(`Informe CST ou CSOSN, conforme o CRT, no item ${index + 1}`)
    return { ...item, quantity: fixed(item.quantity, 4, 11), unitPrice: fixed(item.unitPrice, 10, 11), grossTotal: itemTotal(item.quantity, item.unitPrice) }
  })
  return { ...draft, items, productsTotal: productsTotal(items) }
}

export const blockerLabels: Record<string, string> = {
  current_xsd_and_tax_rules_validation_not_implemented: "Validação fiscal e pacote XSD vigente ainda não integrados",
  xml_generation_and_xmldsig_not_implemented: "Geração e assinatura do XML ainda não integradas",
  sefaz_transport_and_reconciliation_not_implemented: "Transmissão e consulta à SEFAZ ainda não integradas",
  r2_document_storage_not_implemented: "Armazenamento dos documentos de emissão ainda não integrado",
  a1_certificate_missing_expired_or_unavailable: "Conecte um certificado A1 válido para a empresa",
  company_and_fiscal_profile_inconsistent: "Confira os dados da empresa e a configuração fiscal",
  fiscal_profile_missing: "Preencha a configuração fiscal do emitente",
}
