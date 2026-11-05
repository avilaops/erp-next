export type Discount = { kind: "percent" | "amount" | "target"; value: number }
export type SimulationInput = {
  versionId: string; productId: string; quantity: number; destination: string
  taxpayer: boolean; discount: Discount; freightCents: number
}
export type Equipment = {
  productId: string; sku: string; name: string; unit: string
  priceWithoutIpiCents: number; priceWithIpiCents: number
  structureColors: string[]; upholsteryColors: string[]
}
export type PublishedTable = {
  id: string; version: number; publishedAt: string; originState: string
  freeDiscountBps: number; minimumDownPaymentBps: number; ipiBps: number; items: Equipment[]
}
export type SimulatorOptions = {
  tenantId: string; line: string; canCreate: boolean
  versions: { id: string; version: number; publishedAt: string }[]
  data: PublishedTable | null
}
export type Sale = {
  quantity: number; tableUnitCents: number; tableTotalCents: number
  discountCents: number; discountBps: number; unitWithoutIpiCents: number
  unitWithIpiCents: number; netSaleCents: number; ipiCents: number; ipiBps: number
  invoiceTotalCents: number; minimumDownPaymentBps: number; minimumDownPaymentCents: number
  freeDiscountBps: number; freightCents: number
  band: "at_target" | "below_target" | "loss"; needsApproval: boolean; approvalReasons: string[]
}
export type Director = {
  icmsCents: number; pisCofinsCents: number; channelCents: number; provisionsCents: number
  equipmentCostCents: number; fixedFeeCents: number; roundingCents: number
  profitBeforeIncomeTaxCents: number; incomeTaxCents: number; netProfitCents: number
  netProfitBps: number; targetMarginBps: number; atTargetBps: number | null; noLossBps: number | null
  minimumTargetUnitWithIpiCents: number; supplierPaymentCents: number
  targetProfitCents: number; downPaymentCommissionCents: number
  requiredDownPaymentCents: number; requiredDownPaymentBps: number
}
export type Simulation = {
  tenantId: string; line: string; versionId: string; version: number; digest: string
  product: { sku: string; name: string; unit: string }
  input: SimulationInput; sale: Sale; director?: Director
}
export const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
export const percent = (bps: number) => (bps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%"
export const bands = { at_target: "Na meta", below_target: "Abaixo da meta", loss: "Prejuízo" }
export const reasons: Record<string, string> = {
  discount_above_free: "Desconto acima do livre", below_target: "Lucro abaixo da meta",
}
export function hundredths(raw: string): number | null {
  if (!/^\d{1,12}(?:[.,]\d{1,2})?$/.test(raw.trim())) return null
  const [whole, fraction = ""] = raw.trim().replace(",", ".").split(".")
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
  return Number.isSafeInteger(value) ? value : null
}
export function discountFromEntry(kind: Discount["kind"], raw: string): Discount | null {
  const value = hundredths(raw)
  if (value === null || (kind === "percent" && value >= 10000) || (kind === "target" && !value)) return null
  return { kind, value }
}

export function parseSimulation(value: unknown, tenantId: string, line: string, input: SimulationInput): Simulation {
  const fail = () => { throw Error("Resultado incompleto ou divergente. Simule novamente.") }
  if (!value || typeof value !== "object") return fail()
  const result = value as Simulation
  const sale = result.sale
  if (result.tenantId !== tenantId || result.line !== line || result.versionId !== input.versionId
    || !Number.isSafeInteger(result.version) || result.version < 1 || !/^[a-f0-9]{64}$/.test(result.digest)
    || !result.product || typeof result.product.name !== "string" || typeof result.product.sku !== "string"
    || !sale || !result.input) return fail()
  for (const key of ["versionId", "productId", "quantity", "destination", "taxpayer", "freightCents"] as const) {
    if (result.input[key] !== input[key]) return fail()
  }
  if (result.input.discount?.kind !== input.discount.kind || result.input.discount.value !== input.discount.value) return fail()
  const amounts = [sale.tableUnitCents, sale.tableTotalCents, sale.discountCents, sale.unitWithoutIpiCents, sale.unitWithIpiCents,
    sale.netSaleCents, sale.ipiCents, sale.invoiceTotalCents, sale.minimumDownPaymentCents, sale.freightCents]
  if (!amounts.every(n => Number.isSafeInteger(n) && n >= 0 && n <= 99_999_999_999_999)
    || ![sale.discountBps, sale.ipiBps, sale.minimumDownPaymentBps, sale.freeDiscountBps].every(n => Number.isInteger(n) && n >= 0 && n <= 10000)
    || sale.quantity !== input.quantity || sale.tableUnitCents * sale.quantity !== sale.tableTotalCents
    || sale.unitWithoutIpiCents * sale.quantity !== sale.netSaleCents || sale.unitWithIpiCents * sale.quantity !== sale.invoiceTotalCents
    || sale.netSaleCents + sale.ipiCents !== sale.invoiceTotalCents || sale.tableTotalCents - sale.netSaleCents !== sale.discountCents
    || !sale.invoiceTotalCents || sale.freightCents !== input.freightCents || !Object.hasOwn(bands, sale.band)
    || typeof sale.needsApproval !== "boolean" || !Array.isArray(sale.approvalReasons)
    || !sale.approvalReasons.every(reason => Object.hasOwn(reasons, reason))) return fail()
  if (result.director) {
    for (const [key, amount] of Object.entries(result.director)) {
      if (["atTargetBps", "noLossBps"].includes(key) && amount === null) continue
      if (!Number.isSafeInteger(amount)) return fail()
    }
    if (!Number.isSafeInteger(result.director.netProfitCents) || !Number.isSafeInteger(result.director.requiredDownPaymentCents)) return fail()
  }
  return result
}
