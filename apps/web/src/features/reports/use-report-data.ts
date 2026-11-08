"use client"

import { useResource } from "@/hooks/use-operation"
import { financeMetrics, financeRows, stockMetrics, type FinancialResult, type StockResult } from "./report-model"

export function useFinanceReport() {
  const receivables = useResource<FinancialResult>("/api/erp/receivables?limit=100&offset=0")
  const payables = useResource<FinancialResult>("/api/erp/financial-payables?limit=100&offset=0")
  const received = receivables.value?.data || []
  const owed = payables.value?.data || []
  const error = receivables.error || payables.error

  return {
    receivables: received,
    payables: owed,
    metrics: financeMetrics(received, owed),
    rows: financeRows(received, owed).slice(0, 100),
    loading: receivables.loading || payables.loading,
    error,
    status: receivables.error ? receivables.status : payables.status,
    reload() { receivables.reload(); payables.reload() },
  }
}

export function useStockReport(offset: number) {
  const resource = useResource<StockResult>(`/api/erp/stock?limit=100&offset=${offset}`)
  return { ...resource, metrics: stockMetrics(resource.value) }
}
