"use client"
import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { erpFetch } from "@/lib/api/client"
import type { OperationNature } from "./fiscal-preferences"

export function OperationNaturePicker({tenant,onApply}:{tenant:string;onApply:(nature:OperationNature,revision:number)=>void}) {
  const [items,setItems] = useState<OperationNature[]>([])
  const [revision,setRevision] = useState(0)
  const [selected,setSelected] = useState("")
  const [error,setError] = useState("")
  const [loading,setLoading] = useState(true)
  const [reload,setReload] = useState(0)
  const refresh = useCallback(()=>{setLoading(true);setError("");setReload(value=>value+1)},[])
  useEffect(()=>{
    const returned = ()=>{if (document.visibilityState === "visible") refresh()}
    window.addEventListener("focus",returned)
    document.addEventListener("visibilitychange",returned)
    return ()=>{window.removeEventListener("focus",returned);document.removeEventListener("visibilitychange",returned)}
  },[refresh])
  useEffect(()=>{
    const controller = new AbortController()
    erpFetch("/api/erp/fiscal/settings/operation-natures",{cache:"no-store",signal:controller.signal}).then(async response=>{
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Não foi possível consultar as naturezas")
      if (value.tenantId !== tenant || !Array.isArray(value.data?.items)) throw new Error("Reabra o rascunho para conferir a empresa")
      if (!controller.signal.aborted) {
        const available = value.data.items.filter((item:OperationNature)=>item.active && item.model===55 && item.purpose===1 && item.direction==="outgoing")
        setItems(available);setRevision(value.revision)
        setSelected(previous=>available.some((item:OperationNature)=>item.id===previous)?previous:"")
      }
    }).catch(reason=>{if (!controller.signal.aborted) {setItems([]);setSelected("");setRevision(0);setError(reason instanceof Error ? reason.message : "Não foi possível consultar as naturezas")}})
      .finally(()=>{if (!controller.signal.aborted) setLoading(false)})
    return ()=>controller.abort()
  },[tenant,reload])
  return <div className="space-y-2">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap items-end gap-3"><label className="grid min-w-0 flex-1 gap-2 text-sm">Natureza cadastrada<select disabled={loading} value={selected} onChange={event=>setSelected(event.target.value)} className="h-10 w-full rounded-lg border bg-background px-3"><option value="">{loading ? "Carregando naturezas…" : "Selecione uma natureza cadastrada"}</option>{items.map(item=><option key={item.id} value={item.id}>{item.code}: {item.name}</option>)}</select></label><Button type="button" variant="outline" disabled={loading || !selected} onClick={()=>{const item=items.find(item=>item.id===selected);if(item)onApply(item,revision)}}>Aplicar natureza</Button><Button type="button" variant="outline" size="icon" aria-label="Atualizar naturezas" title="Atualizar naturezas" disabled={loading} onClick={refresh}><RefreshCw className="size-4" aria-hidden="true" /></Button></div>
    {!loading && !error && !items.length && <p role="status" className="text-sm text-muted-foreground">Nenhuma natureza ativa de saída para NF-e normal cadastrada.</p>}
    <Link href="/preferencias/fiscal/naturezas" target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">Gerenciar naturezas de operação</Link>
  </div>
}
