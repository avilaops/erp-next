"use client"

import { useState } from "react"
import { AccessLink } from "@/components/feedback/session-recovery"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useResource } from "@/hooks/use-operation"
import { erpFetch } from "@/lib/api/client"

type Dataset = "products"|"parties"|"sales_orders"|"stock_movements"|"audit_log"
type Report = { id:string; name:string; dataset:Dataset; columns:string[]; filters:Record<string,string|number|boolean>; visibility:"private"|"tenant"; revision:number }
type Snapshot = { tenantId:string; data:Report[]; canEdit:boolean }
type Draft = { name:string; dataset:Dataset; columns:string[]; filterColumn:string; filterValue:string; visibility:"private"|"tenant" }

const datasets: Record<Dataset,{label:string;columns:Record<string,string>}> = {
  products:{label:"Produtos",columns:{code:"Código",name:"Nome",status:"Situação"}},
  parties:{label:"Clientes e fornecedores",columns:{name:"Nome",document:"Documento",kind:"Tipo",status:"Situação"}},
  sales_orders:{label:"Pedidos de venda",columns:{number:"Número",customer:"Cliente",status:"Situação",issued_at:"Emissão",total:"Total"}},
  stock_movements:{label:"Movimentações de estoque",columns:{occurred_at:"Data",product:"Produto",warehouse:"Depósito",quantity:"Quantidade",kind:"Tipo"}},
  audit_log:{label:"Registro de atividades",columns:{created_at:"Data",actor:"Usuário",action:"Ação",entity_type:"Entidade"}},
}
const empty: Draft = {name:"",dataset:"products",columns:["code","name"],filterColumn:"",filterValue:"",visibility:"private"}

export function CustomReports() {
  const resource=useResource<Snapshot>("/api/erp/system/custom-reports")
  const [draft,setDraft]=useState<Draft>(empty); const [busy,setBusy]=useState(""); const [error,setError]=useState(""); const [notice,setNotice]=useState("")
  const contract=datasets[draft.dataset]
  function changeDataset(dataset:Dataset){const columns=Object.keys(datasets[dataset].columns);setDraft({...draft,dataset,columns:columns.slice(0,2),filterColumn:"",filterValue:""})}
  function toggleColumn(column:string){setDraft({...draft,columns:draft.columns.includes(column)?draft.columns.filter(value=>value!==column):[...draft.columns,column]})}
  async function create(){
    if(busy)return;setBusy("create");setError("");setNotice("")
    const filters=draft.filterColumn&&draft.filterValue?{[draft.filterColumn]:draft.filterValue}:{}
    try{const response=await erpFetch("/api/erp/system/custom-reports",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:draft.name,dataset:draft.dataset,columns:draft.columns,filters,visibility:draft.visibility})});const body=await response.json();if(!response.ok)throw new Error(body.title||"Não foi possível criar o relatório");setDraft(empty);setNotice("Definição de relatório criada.");resource.reload()}catch(reason){setError(reason instanceof Error?reason.message:"Falha ao criar relatório")}finally{setBusy("")}
  }
  async function changeVisibility(report:Report){
    if(busy)return;setBusy(report.id);setError("");setNotice("")
    const visibility=report.visibility==="private"?"tenant":"private"
    try{const response=await erpFetch(`/api/erp/system/custom-reports/${report.id}`,{method:"PUT",headers:{"Content-Type":"application/json","If-Match":`"${report.revision}"`},body:JSON.stringify({name:report.name,dataset:report.dataset,columns:report.columns,filters:report.filters,visibility})});const body=await response.json();if(!response.ok)throw new Error(body.title||"Não foi possível alterar a visibilidade");setNotice(visibility==="tenant"?"Relatório compartilhado com a empresa.":"Relatório agora é privado.");resource.reload()}catch(reason){setError(reason instanceof Error?reason.message:"Falha ao alterar relatório")}finally{setBusy("")}
  }
  return <div className="mx-auto max-w-5xl space-y-6 px-4 pb-28 pt-8 lg:px-6">

    {resource.error&&<div role="alert" className="form-section space-y-3"><p>{resource.error}</p>{resource.status===401?<AccessLink/>:<Button variant="outline" onClick={resource.reload}>Tentar novamente</Button>}</div>}
    {resource.value?.canEdit&&<section className="form-section space-y-5" aria-labelledby="new-report"><h2 id="new-report" className="text-lg font-semibold">Novo relatório</h2><div className="grid gap-4 sm:grid-cols-2">
      <label className="grid gap-2 text-sm font-medium">Nome<Input value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/></label>
      <label className="grid gap-2 text-sm font-medium">Fonte<select className="min-h-11 rounded-lg border bg-background px-3" value={draft.dataset} onChange={event=>changeDataset(event.target.value as Dataset)}>{Object.entries(datasets).map(([value,item])=><option key={value} value={value}>{item.label}</option>)}</select></label>
      <fieldset className="space-y-2 sm:col-span-2"><legend className="text-sm font-medium">Colunas</legend><div className="flex flex-wrap gap-3">{Object.entries(contract.columns).map(([value,label])=><label className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm" key={value}><input type="checkbox" checked={draft.columns.includes(value)} onChange={()=>toggleColumn(value)}/>{label}</label>)}</div></fieldset>
      <label className="grid gap-2 text-sm font-medium">Filtrar por (opcional)<select className="min-h-11 rounded-lg border bg-background px-3" value={draft.filterColumn} onChange={event=>setDraft({...draft,filterColumn:event.target.value})}><option value="">Sem filtro</option>{Object.entries(contract.columns).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label className="grid gap-2 text-sm font-medium">Valor do filtro<Input disabled={!draft.filterColumn} value={draft.filterValue} onChange={event=>setDraft({...draft,filterValue:event.target.value})}/></label>
      <label className="grid gap-2 text-sm font-medium">Visibilidade<select className="min-h-11 rounded-lg border bg-background px-3" value={draft.visibility} onChange={event=>setDraft({...draft,visibility:event.target.value as Draft["visibility"]})}><option value="private">Somente para mim</option><option value="tenant">Toda a empresa</option></select></label>
    </div><Button disabled={!!busy||!draft.name.trim()||!draft.columns.length||!!draft.filterColumn&&!draft.filterValue.trim()} onClick={create}>Criar relatório</Button></section>}
    <section className="form-section space-y-4" aria-labelledby="reports"><h2 id="reports" className="text-lg font-semibold">Relatórios cadastrados</h2>{resource.loading&&<p role="status">Carregando relatórios…</p>}{resource.value&&!resource.value.data.length&&<p>Nenhum relatório customizado cadastrado.</p>}<ul className="divide-y divide-border">{resource.value?.data.map(report=><li className="flex flex-wrap items-center justify-between gap-3 py-4" key={report.id}><div><strong className="block">{report.name}</strong><span className="text-sm text-muted-foreground">{datasets[report.dataset].label} · {report.columns.length} coluna(s) · {report.visibility==="tenant"?"empresa":"privado"}</span></div>{resource.value?.canEdit&&<Button variant="outline" disabled={!!busy} onClick={()=>changeVisibility(report)}>{report.visibility==="tenant"?"Tornar privado":"Compartilhar"}</Button>}</li>)}</ul></section>
    {error&&<p role="alert" className="form-section text-destructive">{error}</p>}{notice&&<p role="status" className="form-section">{notice}</p>}
  </div>
}
