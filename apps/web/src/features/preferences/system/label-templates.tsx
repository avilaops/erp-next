"use client"

import { useState } from "react"
import { PageHeader } from "@/components/page-header"
import { AccessLink } from "@/components/feedback/session-recovery"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useResource } from "@/hooks/use-operation"
import { erpFetch } from "@/lib/api/client"

type Source = "product" | "party" | "sales_order"
type ElementKind = "text" | "barcode"
type LabelElement = { kind:ElementKind; field:string; label:string; xMm:number; yMm:number; widthMm:number; heightMm:number; fontSizePt:number }
type Template = { id:string; name:string; widthMm:number; heightMm:number; layout:{source:Source;elements:LabelElement[]}; revision:number }
type Snapshot = { tenantId:string; data:Template[]; canEdit:boolean }
type Draft = { name:string; widthMm:number; heightMm:number; source:Source; elements:LabelElement[] }

const sources: Record<Source,{label:string;fields:Record<string,string>}> = {
  product:{label:"Produto",fields:{code:"Código",name:"Nome",unit:"Unidade",price:"Preço"}},
  party:{label:"Cliente ou fornecedor",fields:{name:"Nome",document:"Documento",kind:"Tipo"}},
  sales_order:{label:"Pedido de venda",fields:{number:"Número",customer:"Cliente",issued_at:"Emissão",total:"Total"}},
}
const emptyElement = (field="name"): LabelElement => ({kind:"text",field,label:"",xMm:2,yMm:2,widthMm:96,heightMm:12,fontSizePt:10})
const empty: Draft = {name:"",widthMm:100,heightMm:50,source:"product",elements:[emptyElement()]}

export function LabelTemplates() {
  const resource=useResource<Snapshot>("/api/erp/system/label-templates")
  const [draft,setDraft]=useState<Draft>(empty); const [editing,setEditing]=useState<{id:string;revision:number}|null>(null); const [busy,setBusy]=useState(""); const [error,setError]=useState(""); const [notice,setNotice]=useState("")
  const fields=sources[draft.source].fields
  function changeSource(source:Source){setDraft({...draft,source,elements:[emptyElement(Object.keys(sources[source].fields)[0])]})}
  function updateElement(index:number,patch:Partial<LabelElement>){setDraft({...draft,elements:draft.elements.map((element,current)=>current===index?{...element,...patch}:element)})}
  function addElement(){const next=draft.elements.length*4+2;setDraft({...draft,elements:[...draft.elements,{...emptyElement(Object.keys(fields)[0]),yMm:Math.min(next,Math.max(0,draft.heightMm-12))}]})}
  async function save(payload:Draft,id?:string,revision?:number){
    if(busy)return;setBusy(id||"create");setError("");setNotice("")
    try{const response=await erpFetch(id?`/api/erp/system/label-templates/${id}`:"/api/erp/system/label-templates",{method:id?"PUT":"POST",headers:{"Content-Type":"application/json",...(revision?{"If-Match":`"${revision}"`}:{})},body:JSON.stringify(payload)});const body=await response.json();if(!response.ok)throw new Error(body.title||"Não foi possível salvar o modelo");setDraft(empty);setEditing(null);setNotice(id?"Modelo atualizado.":"Modelo de etiqueta criado.");resource.reload()}catch(reason){setError(reason instanceof Error?reason.message:"Falha ao salvar modelo")}finally{setBusy("")}
  }
  return <div className="mx-auto max-w-6xl space-y-6 px-4 pb-28 pt-8 lg:px-6">
    <PageHeader eyebrow="Preferências / Sistema" title="Etiquetas customizadas" description="Defina modelos de impressão usando apenas campos autorizados do ERP. A impressão e a contratação logística continuam em seus fluxos próprios." />
    {resource.error&&<div role="alert" className="form-section space-y-3"><p>{resource.error}</p>{resource.status===401?<AccessLink/>:<Button variant="outline" onClick={resource.reload}>Tentar novamente</Button>}</div>}
    {resource.value?.canEdit&&<section className="form-section space-y-5" aria-labelledby="new-label"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="new-label" className="text-lg font-semibold">{editing?"Editar modelo":"Novo modelo"}</h2>{editing&&<Button variant="outline" onClick={()=>{setEditing(null);setDraft(empty)}}>Cancelar edição</Button>}</div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="grid gap-2 text-sm font-medium sm:col-span-2">Nome<Input value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/></label>
      <label className="grid gap-2 text-sm font-medium">Largura (mm)<Input type="number" min="10" max="300" value={draft.widthMm} onChange={event=>setDraft({...draft,widthMm:Number(event.target.value)})}/></label>
      <label className="grid gap-2 text-sm font-medium">Altura (mm)<Input type="number" min="10" max="300" value={draft.heightMm} onChange={event=>setDraft({...draft,heightMm:Number(event.target.value)})}/></label>
      <label className="grid gap-2 text-sm font-medium sm:col-span-2">Fonte<select className="min-h-11 rounded-lg border bg-background px-3" value={draft.source} onChange={event=>changeSource(event.target.value as Source)}>{Object.entries(sources).map(([value,item])=><option key={value} value={value}>{item.label}</option>)}</select></label>
    </div><div className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-semibold">Elementos</h3><Button variant="outline" disabled={draft.elements.length>=32} onClick={addElement}>Adicionar elemento</Button></div>{draft.elements.map((element,index)=><fieldset className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4" key={index}><legend className="px-2 text-sm font-medium">Elemento {index+1}</legend>
      <label className="grid gap-2 text-sm">Tipo<select className="min-h-11 rounded-lg border bg-background px-3" value={element.kind} onChange={event=>updateElement(index,{kind:event.target.value as ElementKind})}><option value="text">Texto</option><option value="barcode">Código de barras</option></select></label>
      <label className="grid gap-2 text-sm">Campo<select className="min-h-11 rounded-lg border bg-background px-3" value={element.field} onChange={event=>updateElement(index,{field:event.target.value})}>{Object.entries(fields).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label className="grid gap-2 text-sm lg:col-span-2">Rótulo opcional<Input value={element.label} onChange={event=>updateElement(index,{label:event.target.value})}/></label>
      {([['xMm','X (mm)'],['yMm','Y (mm)'],['widthMm','Largura (mm)'],['heightMm','Altura (mm)'],['fontSizePt','Fonte (pt)']] as const).map(([key,label])=><label className="grid gap-2 text-sm" key={key}>{label}<Input type="number" min={key==='fontSizePt'?4:0} step="0.5" value={element[key]} onChange={event=>updateElement(index,{[key]:Number(event.target.value)})}/></label>)}
      {draft.elements.length>1&&<Button className="self-end" variant="outline" onClick={()=>setDraft({...draft,elements:draft.elements.filter((_,current)=>current!==index)})}>Remover</Button>}
    </fieldset>)}</div><Button disabled={!!busy||!draft.name.trim()||!draft.elements.length} onClick={()=>save(draft,editing?.id,editing?.revision)}>{editing?"Salvar alterações":"Criar modelo"}</Button></section>}
    <section className="form-section space-y-4" aria-labelledby="templates"><h2 id="templates" className="text-lg font-semibold">Modelos cadastrados</h2>{resource.loading&&<p role="status">Carregando modelos…</p>}{resource.value&&!resource.value.data.length&&<p>Nenhum modelo de etiqueta cadastrado.</p>}<ul className="divide-y divide-border">{resource.value?.data.map(template=><li className="flex flex-wrap items-center justify-between gap-3 py-4" key={template.id}><div><strong className="block">{template.name}</strong><span className="text-sm text-muted-foreground">{sources[template.layout.source].label} · {template.widthMm} × {template.heightMm} mm · {template.layout.elements.length} elemento(s)</span></div>{resource.value?.canEdit&&<Button variant="outline" disabled={!!busy} onClick={()=>{setDraft({name:template.name,widthMm:template.widthMm,heightMm:template.heightMm,source:template.layout.source,elements:template.layout.elements});setEditing({id:template.id,revision:template.revision});window.scrollTo({top:0,behavior:"smooth"})}}>Editar</Button>}</li>)}</ul></section>
    {error&&<p role="alert" className="form-section text-destructive">{error}</p>}{notice&&<p role="status" className="form-section">{notice}</p>}
  </div>
}
