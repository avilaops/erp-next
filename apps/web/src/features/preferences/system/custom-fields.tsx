"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AccessLink } from "@/components/feedback/session-recovery"
import { useResource } from "@/hooks/use-operation"
import { erpFetch } from "@/lib/api/client"

type Field = { id:string; entityType:"product"|"party"|"sales_order"; code:string; label:string; valueType:"text"|"number"|"boolean"|"date"|"choice"; required:boolean; choices:string[]; status:"active"|"archived"; revision:number }
type Snapshot = { tenantId:string; data:Field[]; canEdit:boolean }
const empty = { entityType:"product", code:"", label:"", valueType:"text", required:false, choices:"" }
const entities = { product:"Produto", party:"Cliente ou fornecedor", sales_order:"Pedido de venda" }
const types = { text:"Texto", number:"Número", boolean:"Sim ou não", date:"Data", choice:"Lista de opções" }

export function CustomFields() {
  const resource=useResource<Snapshot>("/api/erp/system/custom-fields")
  const [draft,setDraft]=useState(empty); const [busy,setBusy]=useState(""); const [error,setError]=useState(""); const [notice,setNotice]=useState("")
  async function create() {
    if (busy) return; setBusy("create"); setError(""); setNotice("")
    try { const response=await erpFetch("/api/erp/system/custom-fields",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...draft,choices:draft.valueType==="choice"?draft.choices.split("\n"):[]})}); const body=await response.json(); if(!response.ok) throw new Error(body.title||"Não foi possível criar o campo"); setDraft(empty); setNotice("Campo customizado criado."); resource.reload() } catch(reason){setError(reason instanceof Error?reason.message:"Falha ao criar campo") } finally {setBusy("")}
  }
  async function archive(field:Field) {
    if(busy||!window.confirm(`Arquivar o campo “${field.label}”? Os valores existentes serão preservados.`)) return; setBusy(field.id); setError(""); setNotice("")
    try { const response=await erpFetch(`/api/erp/system/custom-fields/${field.id}`,{method:"PUT",headers:{"Content-Type":"application/json","If-Match":`"${field.revision}"`},body:JSON.stringify({entityType:field.entityType,code:field.code,label:field.label,valueType:field.valueType,required:field.required,choices:field.choices,status:"archived"})}); const body=await response.json(); if(!response.ok) throw new Error(body.title||"Não foi possível arquivar o campo"); setNotice("Campo arquivado; valores existentes foram preservados."); resource.reload() } catch(reason){setError(reason instanceof Error?reason.message:"Falha ao arquivar campo") } finally {setBusy("")}
  }
  return <div className="mx-auto max-w-5xl space-y-6 px-4 pb-28 pt-8 lg:px-6">

    {resource.error&&<div role="alert" className="form-section space-y-3"><p>{resource.error}</p>{resource.status===401?<AccessLink/>:<Button variant="outline" onClick={resource.reload}>Tentar novamente</Button>}</div>}
    {resource.value?.canEdit&&<section className="form-section space-y-4" aria-labelledby="new-field"><h2 id="new-field" className="text-lg font-semibold">Novo campo</h2><div className="grid gap-4 sm:grid-cols-2">
      <label className="grid gap-2 text-sm font-medium">Entidade<select className="min-h-11 rounded-lg border bg-background px-3" value={draft.entityType} onChange={e=>setDraft({...draft,entityType:e.target.value})}>{Object.entries(entities).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label className="grid gap-2 text-sm font-medium">Código<Input value={draft.code} placeholder="ex.: referencia_interna" onChange={e=>setDraft({...draft,code:e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,"")})}/></label>
      <label className="grid gap-2 text-sm font-medium">Nome<Input value={draft.label} onChange={e=>setDraft({...draft,label:e.target.value})}/></label>
      <label className="grid gap-2 text-sm font-medium">Tipo<select className="min-h-11 rounded-lg border bg-background px-3" value={draft.valueType} onChange={e=>setDraft({...draft,valueType:e.target.value,choices:""})}>{Object.entries(types).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      {draft.valueType==="choice"&&<label className="grid gap-2 text-sm font-medium sm:col-span-2">Opções, uma por linha<textarea className="min-h-28 rounded-lg border bg-background p-3" value={draft.choices} onChange={e=>setDraft({...draft,choices:e.target.value})}/></label>}
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={draft.required} onChange={e=>setDraft({...draft,required:e.target.checked})}/>Preenchimento obrigatório</label>
    </div><Button disabled={!!busy||!draft.code||!draft.label} onClick={create}>Criar campo</Button></section>}
    <section className="form-section space-y-4" aria-labelledby="fields"><h2 id="fields" className="text-lg font-semibold">Campos cadastrados</h2>{resource.loading&&<p role="status">Carregando campos…</p>}{resource.value&&!resource.value.data.length&&<p>Nenhum campo customizado cadastrado.</p>}<ul className="divide-y divide-border">{resource.value?.data.map(field=><li className="flex flex-wrap items-center justify-between gap-3 py-4" key={field.id}><div><strong className="block">{field.label}</strong><span className="text-sm text-muted-foreground">{entities[field.entityType]} · {types[field.valueType]} · {field.code}{field.required?" · obrigatório":""}{field.status==="archived"?" · arquivado":""}</span></div>{field.status==="active"&&resource.value?.canEdit&&<Button variant="outline" disabled={!!busy} onClick={()=>archive(field)}>Arquivar</Button>}</li>)}</ul></section>
    {error&&<p role="alert" className="form-section text-destructive">{error}</p>}{notice&&<p role="status" className="form-section">{notice}</p>}
  </div>
}
