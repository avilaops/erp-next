"use client"

import { useEffect, useState } from "react"
import { erpFetch } from "@/lib/api/client"
import type { Schema } from "@/lib/api/types"

type Category = Schema<"Reference">
type CategoryList = Schema<"ReferenceList">

export function ProductCategory({ value, onChange, disabled = false, all = false }: {
  value: string; onChange: (value: string) => void; disabled?: boolean; all?: boolean
}) {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      const records: Category[] = []
      let offset = 0
      for (;;) {
        const response = await erpFetch(`/api/erp/product-categories?limit=100&offset=${offset}`, { signal: controller.signal, cache: "no-store" })
        if (!response.ok) throw new Error("Categorias indisponíveis. O vínculo atual será preservado.")
        const page: CategoryList = await response.json()
        records.push(...page.data)
        offset += page.data.length
        if (offset >= page.total) break
        if (!page.data.length) throw new Error("Não foi possível carregar todas as categorias.")
      }
      if (!controller.signal.aborted) setCategories(records)
    }
    load().catch(reason => { if (!controller.signal.aborted) setError(reason.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])
  return <label className="space-y-2">Categoria
    <select name="category_id" className="block h-8 max-w-full rounded-lg border bg-background px-3" value={value} disabled={disabled || loading || !!error} onChange={event => onChange(event.target.value)}>
      <option value="">{all ? "Todas as categorias" : "Sem categoria"}</option>
      {value && !categories.some(category => category.id === value) && <option value={value}>Categoria atual ({value})</option>}
      {categories.filter(category => all || category.status === "active" || category.id === value).map(category => <option key={category.id} value={category.id}>{category.name}{category.status === "archived" ? " (arquivada)" : ""}</option>)}
    </select>
    {error && <span role="status" className="block text-sm text-muted-foreground">{error}</span>}
  </label>
}
