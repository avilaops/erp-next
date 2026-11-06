"use client"

import { useEffect, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { AccessLink } from "@/components/feedback/session-recovery"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { erpFetch } from "@/lib/api/client"

type FileItem={id:string;origin:"system"|"legacy";filename:string;mediaType:string;byteSize:number;sha256:string;status:"pending"|"available"|"quarantined"|"archived";revision:number;versionCount:number;createdAt:string}
type Snapshot={data:FileItem[];total:number;offset:number;limit:number;canEdit:boolean}
const statusLabel:Record<FileItem["status"],string>={pending:"Pendente",available:"Disponível",quarantined:"Em quarentena",archived:"Arquivado"}
function size(bytes:number){if(bytes<1024)return `${bytes} B`;if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} KB`;return `${(bytes/1024/1024).toFixed(1)} MB`}

export function FileManager(){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);const [query,setQuery]=useState("");const [origin,setOrigin]=useState("");const [status,setStatus]=useState("");const [offset,setOffset]=useState(0);const [reload,setReload]=useState(0);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState("");const [error,setError]=useState("");const [notice,setNotice]=useState("")
  useEffect(()=>{const controller=new AbortController();const params=new URLSearchParams({offset:String(offset),limit:"25"});if(query.trim())params.set("q",query.trim());if(origin)params.set("origin",origin);if(status)params.set("status",status);erpFetch(`/api/erp/system/files?${params}`,{cache:"no-store",signal:controller.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.title||"Não foi possível consultar os arquivos");setError("");setSnapshot(body)}).catch(reason=>{if(!controller.signal.aborted){setSnapshot(null);setError(reason instanceof Error?reason.message:"Falha ao consultar arquivos")}}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});return()=>controller.abort()},[query,origin,status,offset,reload])
  function filter(update:()=>void){update();setOffset(0)}
  async function archive(file:FileItem){if(busy)return;setBusy(file.id);setError("");setNotice("");try{const response=await erpFetch(`/api/erp/system/files/${file.id}/archive`,{method:"POST",headers:{"Content-Type":"application/json","If-Match":`"${file.revision}"`},body:"{}"});const body=await response.json();if(!response.ok)throw new Error(body.title||"Não foi possível arquivar o arquivo");setNotice(`${file.filename} foi arquivado.`);setReload(value=>value+1)}catch(reason){setError(reason instanceof Error?reason.message:"Falha ao arquivar arquivo")}finally{setBusy("")}}
  return <div className="mx-auto max-w-6xl space-y-6 px-4 pb-28 pt-8 lg:px-6">
    <PageHeader eyebrow="Preferências / Sistema" title="Gerenciador de arquivos" description="Consulte o catálogo de arquivos da empresa, baixe originais preservados do ERP anterior e arquive registros atuais. O conteúdo atual permanece no storage que o originou; o banco mantém somente seus metadados." />
    <section className="form-section space-y-4" aria-labelledby="file-filters"><h2 id="file-filters" className="text-lg font-semibold">Localizar arquivos</h2><div className="grid gap-4 md:grid-cols-[minmax(16rem,1fr)_12rem_12rem]">
      <label className="grid gap-2 text-sm font-medium">Nome, tipo ou hash<Input value={query} onChange={event=>filter(()=>setQuery(event.target.value))} placeholder="Ex.: nota.xml ou application/pdf" /></label>
      <label className="grid gap-2 text-sm font-medium">Origem<select className="min-h-11 rounded-lg border bg-background px-3" value={origin} onChange={event=>filter(()=>setOrigin(event.target.value))}><option value="">Todas</option><option value="system">ERP atual</option><option value="legacy">ERP anterior</option></select></label>
      <label className="grid gap-2 text-sm font-medium">Situação<select className="min-h-11 rounded-lg border bg-background px-3" value={status} onChange={event=>filter(()=>setStatus(event.target.value))}><option value="">Todas</option>{Object.entries(statusLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    </div></section>
    {error&&<div role="alert" className="form-section space-y-3 text-destructive"><p>{error}</p>{!snapshot&&<AccessLink/>}</div>}{notice&&<p role="status" className="form-section">{notice}</p>}
    <section className="form-section space-y-4" aria-labelledby="files"><div className="flex flex-wrap items-baseline justify-between gap-3"><h2 id="files" className="text-lg font-semibold">Arquivos da empresa</h2>{snapshot&&<span className="text-sm text-muted-foreground">{snapshot.total} arquivo(s)</span>}</div>{loading&&<p role="status">Carregando arquivos…</p>}{!loading&&snapshot?.data.length===0&&<p>Nenhum arquivo corresponde aos filtros.</p>}
      <ul className="divide-y divide-border">{snapshot?.data.map(file=><li className="grid gap-3 py-4 lg:grid-cols-[minmax(12rem,1fr)_minmax(10rem,.7fr)_auto] lg:items-center" key={`${file.origin}-${file.id}`}><div className="min-w-0"><strong className="block truncate">{file.filename}</strong><span className="text-sm text-muted-foreground">{file.origin==="legacy"?"ERP anterior":"ERP atual"} · {statusLabel[file.status]} · {size(file.byteSize)}</span></div><div className="min-w-0 text-xs text-muted-foreground"><span className="block truncate">{file.mediaType}</span><span className="block truncate font-mono" title={file.sha256}>{file.sha256}</span></div><div className="flex flex-wrap gap-2">{file.origin==="legacy"&&<a className={buttonVariants({variant:"outline"})} href={`/api/erp/system/files/${file.id}/content`} download={file.filename}>Baixar</a>}{file.origin==="system"&&file.status!=="archived"&&snapshot.canEdit&&<Button variant="outline" disabled={!!busy} onClick={()=>archive(file)}>{busy===file.id?"Arquivando…":"Arquivar"}</Button>}</div></li>)}</ul>
      {snapshot&&snapshot.total>snapshot.limit&&<div className="flex items-center justify-between gap-4"><Button variant="outline" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-25))}>Anterior</Button><span className="text-sm">Página {Math.floor(offset/25)+1}</span><Button variant="outline" disabled={offset+25>=snapshot.total} onClick={()=>setOffset(offset+25)}>Próxima</Button></div>}
    </section>
  </div>
}
