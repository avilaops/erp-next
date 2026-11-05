"use client"
import Link from "next/link"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { erpFetch } from "@/lib/api/client"
import type { OperationNature } from "./fiscal-preferences"

export function OperationNaturePicker({tenant,onApply}:{tenant:string;onApply:(nature:OperationNature,revision:number)=>void}) {
  const [items,setItems] = useState<OperationNature[]>([])
  const [revision,setRevision] = useState(0)
  const [selected,setSelected] = useState("")
  const [error,setError] = useState("")
  useEffect(()=>{
    const controller = new AbortController()
    erpFetch("/api/erp/fiscal/settings/operation-natures",{cache:"no-store",signal:controller.signal}).then(async response=>{
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Não foi possível consultar as naturezas")
      if (value.tenantId !== tenant || !Array.isArray(value.data?.items)) throw new Error("Reabra o rascunho para conferir a empresa")
      if (!controller.signal.aborted) { setItems(value.data.items.filter((item:OperationNature)=>item.active && item.model===55 && item.purpose===1 && item.direction==="outgoing")); setRevision(value.revision) }
    }).catch(reason=>{if (!controller.signal.aborted) {setItems([]);setError(reason.message)}})
    return ()=>controller.abort()
  },[tenant])
  return <section className="form-section space-y-3"><h2 className="font-semibold">Natureza cadastrada</h2><p className="text-sm text-muted-foreground">Selecione uma natureza ativa de saída normal, modelo 55. Aplicar copia a descrição e a referência; confira e preencha os CFOPs dos itens conforme o destino.</p>
    {error && <p className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap items-end gap-3"><label className="grid min-w-0 flex-1 gap-2 text-sm">Natureza de operação<select value={selected} onChange={event=>setSelected(event.target.value)} className="h-10 w-full rounded-lg border bg-background px-3"><option value="">Selecione uma natureza cadastrada</option>{items.map(item=><option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label><Button type="button" variant="outline" disabled={!selected} onClick={()=>{const item=items.find(item=>item.id===selected);if(item)onApply(item,revision)}}>Aplicar natureza</Button></div>
    <Link href="/preferencias/fiscal/naturezas" target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">Gerenciar naturezas de operação</Link>
  </section>
}
