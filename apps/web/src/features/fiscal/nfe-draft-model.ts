import type { TaxProfile } from "./settings/tax-profile-model"

import type { Schema } from "@/lib/api/types"
export type DraftItem = Schema<"DraftItem">
export type IbptDraftItem = Omit<Schema<"IbptItemSelection">, "origin"> & { origin: "national" | "imported" | "" }
export type IbptDraftSelection = Omit<Schema<"IbptSelection">, "items"> & { items: IbptDraftItem[] }
export type DraftInput = Omit<Schema<"DraftInput">, "taxDeclaration" | "ibpt"> & { taxDeclaration?: TaxDeclaration | null; ibpt?: IbptDraftSelection | null }
export type NfeDraft = Schema<"Draft">
export type FiscalReadiness = Schema<"Readiness">
type TaxBooleanField = "recipientTaxpayer" | "finalConsumer" | "ipiInIcmsBase" | "icmsOutOfContributions"
export type TaxDeclaration = Omit<Schema<"TaxDeclaration">, TaxBooleanField> & Record<TaxBooleanField, boolean | null>

export const blankItem = (): DraftItem => ({ code: "", description: "", unit: "", ncm: "", cfop: "", quantity: "1.0000", unitPrice: "", grossTotal: "0.00", origin: -1, icmsCst: null, csosn: null, pisCst: "", cofinsCst: "" })
export const blankDraft = (): DraftInput => ({ environment: "homologation", model: 55, operationNature: "", taxRuleReference: "", recipient: { taxId: "", legalName: "", state: "", municipalityCode: "", postalCode: "", street: "", number: "", district: "" }, items: [blankItem()], productsTotal: "0.00" })
export const blankTaxDeclaration = (): TaxDeclaration => ({ recipientTaxpayer: null, recipientStateRegistration: null, finalConsumer: null, icmsRate: null, pisRate: null, cofinsRate: null, ipiCst: null, ipiFrameCode: null, ipiRate: null, ipiInIcmsBase: null, icmsOutOfContributions: null, ibsCbs: { cst: "", classCode: "", ibsStateRate: "", ibsCityRate: "", cbsRate: "" } })
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
  const net = gross + freight - discount
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
  const items = draft.items.map((item, index) => {
    if (item.origin < 0) throw new Error(`Informe a origem da mercadoria no item ${index + 1}`)
    if (!!item.icmsCst === !!item.csosn) throw new Error(`Informe CST ou CSOSN, conforme o CRT, no item ${index + 1}`)
    commercialItemCents(item)
    const freightAmount = fixed(item.freightAmount || "0", 2, 13)
    if (scaled(freightAmount) > BigInt(0) && (draft.freightMode ?? "9") === "9") throw new Error("Frete cobrado exige modalidade de transporte diferente de 9")
    return { ...item, ...(item.freightAmount === undefined ? {} : { freightAmount }), ...(item.discountAmount === undefined ? {} : { discountAmount: fixed(item.discountAmount || "0", 2, 13) }), quantity: fixed(item.quantity, 4, 11), unitPrice: fixed(item.unitPrice, 10, 11), grossTotal: itemTotal(item.quantity, item.unitPrice) }
  })
  return { ...input, items, productsTotal: productsTotal(items), ...(ibpt === undefined ? {} : { ibpt: ibpt === null ? null : ibptSubmission(ibpt, items.length) }), ...(taxDeclaration ? { taxDeclaration: declaredTaxes(taxDeclaration) } : {}), ...(draft.payments ? { payments: draft.payments.map(payment => ({ ...payment, amount: fixed(payment.amount, 2, 13) })) } : {}) }
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
}


/** Copies only accountant-declared defaults; all other fiscal decisions stay unchanged. */
export function applyTaxProfile(draft: DraftInput, profile: TaxProfile, revision: number): DraftInput {
  const taxes = draft.taxDeclaration || blankTaxDeclaration()
  const defaults = profile.defaults ?? {}
  return {
    ...draft,
    operationNature: profile.operationNature,
    taxRuleReference: `${profile.name} · revisão ${revision}`,
    items: draft.items.map(item => ({
      ...item,
      ...(!item.icmsCst && !item.csosn && defaults.icmsCst ? { icmsCst: defaults.icmsCst } : {}),
      ...(!item.pisCst && defaults.pisCst ? { pisCst: defaults.pisCst } : {}),
      ...(!item.cofinsCst && defaults.cofinsCst ? { cofinsCst: defaults.cofinsCst } : {})
    })),
    taxDeclaration: {
      ...taxes,
      pisRate: profile.pisRate,
      cofinsRate: profile.cofinsRate,
      ipiCst: taxes.ipiCst || defaults.ipiCst || null,
      ipiFrameCode: taxes.ipiFrameCode || defaults.ipiFrameCode || null,
      finalConsumer: taxes.finalConsumer ?? defaults.finalConsumer ?? null,
      ipiInIcmsBase: taxes.ipiInIcmsBase ?? defaults.ipiInIcmsBase ?? null,
      icmsOutOfContributions: taxes.icmsOutOfContributions ?? defaults.icmsOutOfContributions ?? null,
      ibsCbs: {
        ...taxes.ibsCbs,
        cst: profile.ibsCbsCst,
        classCode: profile.classCode,
        ibsStateRate: taxes.ibsCbs.ibsStateRate || defaults.ibsStateRate || "",
        ibsCityRate: taxes.ibsCbs.ibsCityRate || defaults.ibsCityRate || "",
        cbsRate: taxes.ibsCbs.cbsRate || defaults.cbsRate || ""
      }
    }
  }
}
