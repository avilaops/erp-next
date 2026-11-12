"use client"
import { useId } from "react"
import { Button } from "@/components/ui/button"
import { useReferenceHierarchy } from "@/features/records/reference/use-reference-hierarchy"

export function ProductCategory({ value, onChange, disabled = false, all = false, tenantId }: {
 value: string; onChange: (value: string) => void; disabled?: boolean; all?: boolean; tenantId?: string
}) {
 const id = useId()
 const hierarchy = useReferenceHierarchy("product-categories", tenantId)
 const options = hierarchy.options.filter(row => all || row.available || row.id === value)
 return <div className="min-w-0 space-y-1">
  <label htmlFor={id}>Categoria</label>
  <select id={id} name="category_id" className="block h-9 w-full min-w-0 max-w-full rounded-lg border bg-background px-2 text-sm" value={value} disabled={disabled || hierarchy.loading || !!hierarchy.error} onChange={event => onChange(event.target.value)}>
   <option value="">{all ? "Todas as categorias" : "Sem categoria"}</option>
   {value && !options.some(row => row.id === value) && <option value={value}>Categoria atual · aguardando consulta</option>}
   {options.map(row => <option key={row.id} value={row.id}>{row.path}{row.status === "archived" ? " (arquivada)" : !row.available ? " (superior arquivada)" : ""}</option>)}
  </select>
  {hierarchy.error && <div role="status" className="space-y-1 text-xs text-muted-foreground"><p>{hierarchy.error}</p><Button type="button" variant="outline" className="h-8 px-2 text-xs" onClick={hierarchy.reload}>Atualizar categorias</Button></div>}
 </div>
}
