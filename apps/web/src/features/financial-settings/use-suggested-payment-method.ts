"use client"

import type { Schema } from "@/lib/api/types"

import { useState } from "react"
import { useResource } from "@/features/operations/use-operation"

export type FinancialSettingsSnapshot = Schema<"FinancialSettingsSnapshot">
export const paymentMeans = { bank_transfer: "Transferência", cash: "Dinheiro", card: "Cartão", other: "Outro" }

export function useSuggestedPaymentMethod() {
  const resource = useResource<FinancialSettingsSnapshot>("/api/erp/financial-settings")
  const [selected, setMethod] = useState<string | null>(null)
  const suggested = resource.value?.data.defaultPaymentMethod
  return { method: selected ?? (suggested && suggested in paymentMeans ? suggested : "bank_transfer"), setMethod, loading: resource.loading, error: resource.error }
}
