export const states = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"] as const

export const fieldGroups = [
  { title: "Política comercial", fields: [
    ["netMarginBps", "Lucro líquido desejado", "percent"],
    ["freeDiscountBps", "Desconto livre do vendedor", "percent"],
    ["costSafetyBps", "Margem de segurança sobre o custo", "percent"],
    ["minimumDownPaymentBps", "Entrada mínima", "percent"],
    ["proposalValidityDays", "Validade da proposta", "days"],
  ] },
  { title: "Tributos informados para simulação", fields: [
    ["domesticIcmsBps", "ICMS dentro da UF de origem", "percent"],
    ["pisCofinsBps", "PIS + COFINS", "percent"],
    ["ipiBps", "IPI destacado", "percent"],
    ["incomeTaxBps", "IRPJ + CSLL sobre o lucro", "percent"],
  ] },
  { title: "Canal de venda", fields: [
    ["commissionBps", "Comissão", "percent"],
    ["adsBps", "Anúncios / Ads", "percent"],
    ["gatewayBps", "Gateway e antecipação", "percent"],
    ["interstateBps", "ICMS interestadual padrão", "percent"],
    ["otherFeesBps", "Outras taxas de venda", "percent"],
    ["fixedOrderFeeCents", "Taxa fixa por pedido", "money"],
  ] },
  { title: "Provisões e despesas", fields: [
    ["lossBps", "Perdas", "percent"],
    ["warrantyBps", "Garantia", "percent"],
    ["badDebtBps", "Inadimplência", "percent"],
    ["monthlyExpensesCents", "Despesas fixas por mês", "money"],
  ] },
] as const

type Field = typeof fieldGroups[number]["fields"][number]
type FieldKey = Field[0]
export type Parameters = Record<FieldKey, number> & {
  originState: string
  stateRates: { state: string; internalBps: number; fcpBps: number; outgoingBps: number | null }[]
}
export type Draft = Record<FieldKey, string> & {
  originState: string
  stateRates: { state: string; internalBps: string; fcpBps: string; outgoingBps: string }[]
}
export type Calculation = {
  worstState: string; worstNonContributor: boolean; worstIcmsBps: number
  variableCostsBps: number; requiredPretaxMarginPercent: number
  discountedCostMultiplier: number; tableCostMultiplier: number
  markupPercent: number; rawCostMultiplierWithSafety: number
  monthlyExpensesCents: number; breakEvenRevenue: number | null
  destinationLimits: { state: string; taxpayer: boolean; variableCostsBps: number; atTargetBps: number; noLossBps: number }[]
}
export type EntrySuggestion = { recommendedBps: number; exactBps: number; worstSku: string; canApply: boolean }
export type Snapshot = { tenantId: string; line: string; revision: number; canEdit: boolean; status: "draft"; data: Parameters | null; calculation: Calculation | null; monthlyExpensesCents: number; suggestedDownPayment?: EntrySuggestion | null }

export function toDraft(data: Parameters | null, monthlyExpensesCents = 0): Draft {
  const values = Object.fromEntries(fieldGroups.flatMap(group => group.fields.map(([key, , unit]) =>
    [key, data ? String(data[key] / (unit === "days" ? 1 : 100)).replace(".", ",") : key === "monthlyExpensesCents" ? String(monthlyExpensesCents / 100).replace(".", ",") : ""]))) as Record<FieldKey, string>
  return { ...values, originState: data?.originState || "", stateRates: states.map(state => {
    const row = data?.stateRates.find(rate => rate.state === state)
    return { state, internalBps: row ? String(row.internalBps / 100).replace(".", ",") : "", fcpBps: row ? String(row.fcpBps / 100).replace(".", ",") : "", outgoingBps: row?.outgoingBps == null ? "" : String(row.outgoingBps / 100).replace(".", ",") }
  }) }
}
// Convert decimal text directly to integer hundredths; never round user input.
function hundredths(value: string, label: string): number {
  const normalized = value.trim().replace(",", ".")
  if (!/^\d{1,11}(?:\.\d{1,2})?$/.test(normalized)) throw Error(`${label}: informe um número não negativo com até duas casas decimais.`)
  const [whole, fraction = ""] = normalized.split(".")
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
  if (!Number.isSafeInteger(result)) throw Error(`${label}: valor fora do limite.`)
  return result
}

export function toParameters(draft: Draft): Parameters {
  const values = Object.fromEntries(fieldGroups.flatMap(group => group.fields.map(([key, label, unit]) => {
    if (unit === "days") {
      if (!/^\d{1,4}$/.test(draft[key]) || Number(draft[key]) < 1 || Number(draft[key]) > 3650) throw Error("Validade: informe de 1 a 3650 dias.")
      return [key, Number(draft[key])]
    }
    const value = hundredths(draft[key], label)
    if (value > (unit === "percent" ? 10000 : 1_000_000_000_000)) throw Error(`${label}: valor acima do limite.`)
    return [key, value]
  }))) as Record<FieldKey, number>
  return { ...values, originState: draft.originState, stateRates: draft.stateRates.map(row => ({
    state: row.state, internalBps: hundredths(row.internalBps, `${row.state} interno`),
    fcpBps: hundredths(row.fcpBps, `${row.state} FCP`),
    outgoingBps: row.outgoingBps.trim() === "" ? null : hundredths(row.outgoingBps, `${row.state} saída`),
  })) }
}
