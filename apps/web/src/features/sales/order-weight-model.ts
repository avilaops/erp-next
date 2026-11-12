import { normalizeDecimal } from "@/lib/decimal-input"

type WeightedItem = { quantity: string; weight?: string | null }

export function orderEquipmentWeight(items: WeightedItem[]) {
  let total = BigInt(0)
  let missingWeights = 0
  let invalidQuantities = false
  for (const item of items) {
    const weight = normalizeDecimal((item.weight || "").trim().replace(/\s*kg$/i, "").trim(), 6)
    const quantity = normalizeDecimal(item.quantity, 6)
    if (!weight || BigInt(weight.replace(".", "")) <= BigInt(0)) { missingWeights++; continue }
    if (!quantity || BigInt(quantity.replace(".", "")) <= BigInt(0)) { invalidQuantities = true; continue }
    total += BigInt(weight.replace(".", "")) * BigInt(quantity.replace(".", ""))
  }
  const scale = BigInt("1000000000000")
  const fraction = (total % scale).toString().padStart(12, "0").replace(/0+$/, "")
  const totalKg = missingWeights || invalidQuantities ? null : `${total / scale}${fraction ? `.${fraction}` : ""}`
  return { totalKg, missingWeights, invalidQuantities }
}
