import { emptyRetentions, emptyTransport, type FiscalExtras } from "./nfe-extras-model"
import type { TaxProfile, FiscalScenario } from "./settings/tax-profile-model"

import type { Schema } from "@/lib/api/types"
import type { PartyFiscal } from "../parties/party-cnpj"
export type Exportation = Schema<"Exportation">
export type ExportDetail = Schema<"ExportDetail">
export type DraftItem = Schema<"DraftItem"> & { insuranceAmount?: string | null; otherAmount?: string | null; taxableUnit?: string | null; taxableQuantity?: string | null; taxableUnitPrice?: string | null; exportDetails?: ExportDetail[]; referencedDfe?: { accessKey: string; itemNumber?: number | null } | null }
export type IbptDraftItem = Omit<Schema<"IbptItemSelection">, "origin"> & { origin: "national" | "imported" | "" }
export type IbptDraftSelection = Omit<Schema<"IbptSelection">, "items"> & { items: IbptDraftItem[] }
export type DraftInput = Omit<Schema<"DraftInput">, "taxDeclaration" | "ibpt" | "recipient" | "items"> & FiscalExtras & {
  items: DraftItem[];
  taxDeclaration?: TaxDeclaration | null; ibpt?: IbptDraftSelection | null;
  issuedAt?: string | null; departureAt?: string | null; presenceIndicator?: number | null;
  printType?: number | null; finalConsumer?: boolean | null; salesperson?: string | null;
  exportation?: Exportation | null;
  simplifiedDanfe?: { qrCodeUrl: string; accessKeyUrl: string } | null;
  creditType?: string | null; debitType?: string | null;
  series?: number | null; number?: number | null; crt?: number | null;
  recipient: Schema<"Recipient"> & { complement?: string | null; phone?: string | null; email?: string | null; cityName?: string | null; foreignId?: string | null; countryCode?: string | null; countryName?: string | null };
}
export type NfeDraft = Schema<"Draft">
export type FiscalReadiness = Schema<"Readiness"> & { crt?: number | null; series?: number | null; nextNumber?: number | null }
type TaxBooleanField = "recipientTaxpayer" | "finalConsumer" | "ipiInIcmsBase" | "icmsOutOfContributions"
export type TaxDeclaration = Omit<Schema<"TaxDeclaration">, TaxBooleanField> & Record<TaxBooleanField, boolean | null> & { recipientTaxpayerIndicator?: "1" | "2" | "9" | null }

export const blankItem = (): DraftItem => ({ code: "", description: "", unit: "", ncm: "", cfop: "", quantity: "1.0000", unitPrice: "", grossTotal: "0.00", origin: -1, icmsCst: null, csosn: null, pisCst: "", cofinsCst: "" })
export const blankDraft = (): DraftInput => ({ environment: "homologation", model: 55, purpose: 1, operationNature: "", taxRuleReference: "", recipient: { taxId: "", legalName: "", state: "", municipalityCode: "", postalCode: "", street: "", number: "", district: "" }, items: [blankItem()], productsTotal: "0.00" })
export const blankTaxDeclaration = (): TaxDeclaration => ({ recipientTaxpayer: null, recipientStateRegistration: null, finalConsumer: null, icmsRate: null, pisRate: null, cofinsRate: null, ipiCst: null, ipiFrameCode: null, ipiRate: null, ipiInIcmsBase: null, icmsOutOfContributions: null, ibsCbs: { cst: "", classCode: "", ibsStateRate: "", ibsCityRate: "", cbsRate: "" } })
export function applyRecipientFiscal(draft: DraftInput, fiscal: PartyFiscal | null, crt: number | null): DraftInput {
  if (crt !== 3) return draft
  if (!fiscal && !draft.taxDeclaration) return draft
  const declaration = { ...blankTaxDeclaration(), ...draft.taxDeclaration }
  if (draft.model === 65) return { ...draft, taxDeclaration: { ...declaration, recipientTaxpayerIndicator: "9", recipientTaxpayer: false, recipientStateRegistration: null } }
  return { ...draft, taxDeclaration: { ...declaration, recipientTaxpayerIndicator: fiscal?.taxpayerIndicator, recipientTaxpayer: fiscal ? fiscal.taxpayerIndicator !== "9" : null, recipientStateRegistration: fiscal?.stateRegistration || null } }
}
export const blankIbptItem = (): IbptDraftItem => ({ ex: "", origin: "", version: null })

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
    const product = commercialItemCents(item)
    return sum + product + (product * rate + BigInt(500_000)) / BigInt(1_000_000)
  }, BigInt(0)))
}

function commercialItemCents(item: DraftItem): bigint {
  const gross = scaled(itemTotal(item.quantity, item.unitPrice))
  const freight = scaled(fixed(item.freightAmount || "0", 2, 13))
  const discount = scaled(fixed(item.discountAmount || "0", 2, 13))
  const insurance = scaled(fixed(item.insuranceAmount || "0", 2, 13))
  const other = scaled(fixed(item.otherAmount || "0", 2, 13))
  const net = gross + freight + insurance + other - discount
  if (discount > gross || net <= BigInt(0)) throw new Error("Confira o desconto e o total do item com frete")
  return net
}

function declaredTaxes(declaration: TaxDeclaration): Schema<"TaxDeclaration"> {
  for (const field of ["recipientTaxpayer", "finalConsumer", "ipiInIcmsBase", "icmsOutOfContributions"] as const) {
    if (typeof declaration[field] !== "boolean") throw new Error("Declare contribuinte, consumidor final e composição das bases conforme a instrução fiscal")
  }
  return {
    ...declaration,
    recipientTaxpayer: declaration.recipientTaxpayer === true,
    finalConsumer: declaration.finalConsumer === true,
    ipiInIcmsBase: declaration.ipiInIcmsBase === true,
    icmsOutOfContributions: declaration.icmsOutOfContributions === true,
    icmsRate: declaration.icmsRate ? percent(declaration.icmsRate) : null,
    pisRate: declaration.pisRate ? percent(declaration.pisRate) : null,
    cofinsRate: declaration.cofinsRate ? percent(declaration.cofinsRate) : null,
    ...(declaration.destinationIcmsRate ? { destinationIcmsRate: percent(declaration.destinationIcmsRate) } : {}),
    ...(declaration.destinationFcpRate ? { destinationFcpRate: percent(declaration.destinationFcpRate) } : {}),
    ipiRate: declaration.ipiRate ? percent(declaration.ipiRate) : null,
    ibsCbs: { ...declaration.ibsCbs, ibsStateRate: percent(declaration.ibsCbs.ibsStateRate), ibsCityRate: percent(declaration.ibsCbs.ibsCityRate), cbsRate: percent(declaration.ibsCbs.cbsRate) },
  }
}

export function submission(draft: DraftInput): Schema<"DraftInput"> {
  const { taxDeclaration, ibpt, ...input } = draft
  if (input.transport) {
    input.transport = { ...emptyTransport(), ...input.transport }
    for (const key of ["netWeight", "grossWeight"] as const) if (input.transport[key]) input.transport[key] = fixed(input.transport[key]!, 3, 12)
  }
  if (input.retentions) input.retentions = { ...emptyRetentions(), ...Object.fromEntries(Object.entries(input.retentions).map(([key, value]) => [key, value ? fixed(value, 2, 13) : null])) }
  if (input.installments) input.installments = input.installments.map(item => ({ ...item, amount: fixed(item.amount, 2, 13) }))

  const items = draft.items.map((item, index) => {
    if (item.origin < 0) throw new Error(`Informe a origem da mercadoria no item ${index + 1}`)
    if (!!item.icmsCst === !!item.csosn) throw new Error(`Informe CST ou CSOSN, conforme o CRT, no item ${index + 1}`)
    commercialItemCents(item)
    const freightAmount = fixed(item.freightAmount || "0", 2, 13)
    if (scaled(freightAmount) > BigInt(0) && (draft.freightMode ?? "9") === "9") throw new Error("Frete cobrado exige modalidade de transporte diferente de 9")
    const exportFields = {
      ...(item.taxableQuantity ? { taxableQuantity: fixed(item.taxableQuantity, 4, 11) } : {}),
      ...(item.taxableUnitPrice ? { taxableUnitPrice: fixed(item.taxableUnitPrice, 10, 11) } : {}),
      ...(item.exportDetails ? { exportDetails: item.exportDetails.map(detail => ({ ...detail, ...(detail.exportedQuantity ? { exportedQuantity: fixed(detail.exportedQuantity, 4, 11) } : {}) })) } : {}),
    }
    return { ...item, ...exportFields, ...(item.freightAmount === undefined ? {} : { freightAmount }), ...(item.insuranceAmount == null ? {} : { insuranceAmount: fixed(item.insuranceAmount, 2, 13) }), ...(item.otherAmount == null ? {} : { otherAmount: fixed(item.otherAmount, 2, 13) }), ...(item.discountAmount === undefined ? {} : { discountAmount: fixed(item.discountAmount || "0", 2, 13) }), quantity: fixed(item.quantity, 4, 11), unitPrice: fixed(item.unitPrice, 10, 11), grossTotal: itemTotal(item.quantity, item.unitPrice) }
  })
  return { ...input, items, productsTotal: productsTotal(items), ...(draft.changeAmount === undefined ? {} : { changeAmount: fixed(draft.changeAmount || "0", 2, 13) }), ...(ibpt === undefined ? {} : { ibpt: ibpt === null ? null : ibptSubmission(ibpt, items.length) }), ...(taxDeclaration ? { taxDeclaration: declaredTaxes(taxDeclaration) } : {}), ...(draft.payments ? { payments: draft.payments.map(payment => ({ ...payment, amount: fixed(payment.amount, 2, 13) })) } : {}) }
}

function ibptSubmission(selection: IbptDraftSelection, count: number): Schema<"IbptSelection"> {
  if (!selection.uf || !/^\d{4}-\d{2}-\d{2}$/.test(selection.asOf) || selection.items.length !== count) throw new Error("Informe UF, data e uma escolha IBPT para cada item")
  return {
    uf: selection.uf,
    asOf: selection.asOf,
    items: selection.items.map((item, index) => {
      if (!/^\d{1,3}$/.test(item.ex) || item.origin !== "national" && item.origin !== "imported") throw new Error(`Informe EX e origem IBPT no item ${index + 1}`)
      const version = item.version?.trim() || null
      if (version && !/^\d{2}\.\d\.[A-Z]$/.test(version)) throw new Error(`Informe a versão IBPT no formato 26.2.A no item ${index + 1}`)
      return { ex: item.ex, origin: item.origin, version }
    }),
  }
}

export const blockerLabels: Record<string, string> = {
  fiscal_engine_not_configured: "O motor fiscal ainda não foi configurado",
  homologation_emission_requires_sp: "Emissão disponível para emitente de São Paulo",
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
  production_emission_disabled: "A emissão em produção permanece bloqueada até homologação externa e liberação operacional",
}


/** Copies only accountant-declared defaults; all other fiscal decisions stay unchanged. */
export function applyTaxProfile(draft: DraftInput, profile: TaxProfile, revision: number, scenario?: FiscalScenario): DraftInput {
 const taxes = draft.taxDeclaration || blankTaxDeclaration()
 const rules = profile.lineRules
 const defaults = profile.defaults ?? {}
 const cfop = rules && scenario ? scenario === "sameState" ? rules.cfopSameState : scenario === "interstateTaxpayer" ? rules.cfopInterstateTaxpayer : rules.cfopInterstateNonTaxpayer : null
 return { ...draft, operationNature: profile.operationNature, taxRuleReference: `${profile.name} · revisão ${revision}`, ...(rules ? { additionalInformation: rules.additionalInformation } : {}),
   items: draft.items.map(item => ({ ...item, ...(rules ? { icmsCst: rules.icmsCst, csosn: null, pisCst: rules.pisCst, cofinsCst: rules.cofinsCst } : { ...(!item.icmsCst && !item.csosn && defaults.icmsCst ? { icmsCst: defaults.icmsCst } : {}), ...(!item.pisCst && defaults.pisCst ? { pisCst: defaults.pisCst } : {}), ...(!item.cofinsCst && defaults.cofinsCst ? { cofinsCst: defaults.cofinsCst } : {}) }), ...(cfop ? { cfop } : {}) })),
   taxDeclaration: { ...taxes, pisRate: profile.pisRate, cofinsRate: profile.cofinsRate,
     ...(rules ? { icmsRate: rules.icmsRate, ipiRate: rules.ipiRate, ipiCst: rules.ipiCst, ipiFrameCode: rules.ipiFrameCode, finalConsumer: rules.finalConsumer, ipiInIcmsBase: rules.ipiInIcmsBase, icmsOutOfContributions: rules.icmsOutOfContributions, ...(scenario && scenario !== "sameState" ? { recipientTaxpayer: scenario === "interstateTaxpayer", recipientTaxpayerIndicator: scenario === "interstateNonTaxpayer" ? "9" : taxes.recipientTaxpayerIndicator === "2" ? "2" : "1", ...(scenario === "interstateNonTaxpayer" ? { recipientStateRegistration: null } : {}) } : {}) } : { ipiCst: taxes.ipiCst || defaults.ipiCst || null, ipiFrameCode: taxes.ipiFrameCode || defaults.ipiFrameCode || null, finalConsumer: taxes.finalConsumer ?? defaults.finalConsumer ?? null, ipiInIcmsBase: taxes.ipiInIcmsBase ?? defaults.ipiInIcmsBase ?? null, icmsOutOfContributions: taxes.icmsOutOfContributions ?? defaults.icmsOutOfContributions ?? null }),
     ibsCbs: { ...taxes.ibsCbs, cst: profile.ibsCbsCst, classCode: profile.classCode, ...(rules ? { ibsStateRate: rules.ibsStateRate, ibsCityRate: rules.ibsCityRate, cbsRate: rules.cbsRate } : { ibsStateRate: taxes.ibsCbs.ibsStateRate || defaults.ibsStateRate || "", ibsCityRate: taxes.ibsCbs.ibsCityRate || defaults.ibsCityRate || "", cbsRate: taxes.ibsCbs.cbsRate || defaults.cbsRate || "" }) } } }
}
