"use client"

import { useEffect, useState } from "react"
import { erpFetch } from "@/lib/api/client"
import { Button } from "@/components/ui/button"
import { commercialQuantity } from "./order-presentation"
import { orderEquipmentWeight } from "./order-weight-model"

type Item = { productId: string; quantity: string; equipmentWeight?: string | null }

export function OrderWeightSummary({ tenantId, items }: { tenantId: string; items: Item[] }) {
  const [retry, setRetry] = useState(0)
  const requests = [...new Set(items.filter(item => item.equipmentWeight === undefined).map(item => item.productId))].sort().join(",")
  const key = `${tenantId}:${requests}:${retry}`
  const [profiles, setProfiles] = useState<{ key: string; weights: Record<string, string | null>; failed: boolean } | null>(null)
  useEffect(() => {
    if (!requests) return
    const controller = new AbortController()
    Promise.all(requests.split(",").map(async id => {
      try {
        const response = await erpFetch(`/api/erp/products/${id}/catalog`, { cache: "no-store", signal: controller.signal })
        if (response.status === 404) return { id, weight: null, failed: false }
        const value = await response.json()
        if (!response.ok || value.tenantId !== tenantId || typeof value.data?.weight !== "string") throw Error("Peso indisponível")
        return { id, weight: value.data.weight as string, failed: false }
      } catch { return { id, weight: null, failed: true } }
    })).then(values => {
      if (!controller.signal.aborted) setProfiles({ key, weights: Object.fromEntries(values.map(value => [value.id, value.weight])), failed: values.some(value => value.failed) })
    })
    return () => controller.abort()
  }, [requests, tenantId, key])
  if (!items.length) return null
  const pending = Boolean(requests) && profiles?.key !== key
  const failed = !pending && Boolean(requests) && profiles?.failed
  const summary = orderEquipmentWeight(items.map(item => ({ quantity: item.quantity, weight: item.equipmentWeight === undefined ? profiles?.key === key ? profiles.weights[item.productId] : null : item.equipmentWeight })))
  return <section aria-label="Peso do pedido" className="space-y-1 border-t pt-3 text-sm">
    <dl className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><dt className="font-medium">Peso bruto total</dt><dd className="font-semibold tabular-nums">{pending ? "Consultando pesos…" : summary.totalKg === null ? "Incompleto" : `${commercialQuantity(summary.totalKg)} kg`}</dd></dl>
    {!pending && summary.totalKg === null && <p className="text-xs text-muted-foreground">{failed ? "Não foi possível consultar todos os pesos." : summary.invalidQuantities ? "Confira as quantidades para calcular o peso total." : `Peso não cadastrado ou inválido em ${summary.missingWeights} equipamento(s).`}</p>}
    {failed && <Button type="button" variant="outline" size="sm" className="print:hidden" onClick={() => setRetry(value => value + 1)}>Consultar pesos novamente</Button>}
  </section>
}
