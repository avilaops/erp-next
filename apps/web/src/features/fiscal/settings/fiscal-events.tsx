"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { erpFetch } from "@/lib/api/client"

type Event = { id: string; documentId: string | null; kind: string; sequence: number; status: string; environment: string; series: number | null; number: number | null; accessKey: string | null; request: { text?: string; year?: number; series?: number; first?: number; last?: number }; result: { code?: string; reason?: string; protocol?: string }; createdAt: string }
const statusLabels: Record<string,string> = { registered: "Registrado", pending: "Pendente", rejected: "Rejeitado", unknown: "Sem confirmação" }
export function FiscalEvents({ kind }: { kind: "correcao" | "inutilizacao" }) {
  const [page, setPage] = useState<{ tenant: string; items: Event[]; cursor: string | null } | null>(null)
  const [request, setRequest] = useState<{ cursor?: string }>({})
  const [query,setQuery] = useState("")
  const [error,setError] = useState("")
  const [loading,setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    erpFetch(`/api/erp/fiscal/nfe-events?kind=${kind}&limit=25${request.cursor ? `&cursor=${encodeURIComponent(request.cursor)}` : ""}`, {cache:"no-store",signal:controller.signal}).then(async response => {
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Não foi possível consultar os eventos fiscais")
      if (!value.tenantId || !Array.isArray(value.data)) throw new Error("Resposta fiscal inválida")
      if (controller.signal.aborted) return
      setPage(previous => ({ tenant:value.tenantId,items:previous && request.cursor && previous.tenant === value.tenantId ? [...new Map([...previous.items,...value.data].map(item=>[item.id,item])).values()] : value.data,cursor:value.nextCursor }))
      setError("")
    }).catch(reason => { if (!controller.signal.aborted) { setPage(null); setError(reason.message) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  },[kind,request])
  const items = page?.items.filter(item => `${item.accessKey || ""} ${item.number || ""} ${item.series || item.request.series || ""} ${item.request.text || ""} ${item.result.reason || ""}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"))) || []
  return <main className="mx-auto max-w-5xl space-y-6 px-4 pb-28 pt-8 lg:px-6">
    <Link href="/preferencias?categoria=notas-fiscais" className="text-primary underline">Voltar às preferências</Link>
    <header><h1 className="text-3xl font-semibold">{kind === "correcao" ? "Consulta de correções de NF-es" : "Consulta de inutilizações de NF-es"}</h1><p className="mt-3 text-sm text-muted-foreground">Eventos registrados no ERP para a empresa ativa. Esta consulta não transmite eventos nem solicita inutilização à SEFAZ.</p></header>
    <section className="form-section flex flex-wrap items-end gap-3"><label className="grid min-w-0 flex-1 gap-2 text-sm">Buscar nos eventos carregados<Input value={query} onChange={event=>setQuery(event.target.value)} /></label><Button variant="outline" disabled={loading} onClick={()=>{setLoading(true);setRequest({})}}>Atualizar consulta</Button></section>
    {loading && <p role="status">Carregando eventos…</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {page && !loading && items.length === 0 && <p>{page.items.length ? "Nenhum evento carregado corresponde à busca." : "Nenhum evento desta categoria registrado nesta empresa."}</p>}
    <div className="space-y-4">{items.map(item=><article key={item.id} className="form-section min-w-0 space-y-3">
      <div className="flex flex-wrap justify-between gap-3"><h2 className="font-semibold">{kind === "correcao" ? `CC-e ${item.sequence} · NF-e ${item.number ?? "sem número"}` : `Inutilização · ${item.request.year ?? ""} · Série ${item.request.series ?? ""}`}</h2><span>{statusLabels[item.status] || item.status}</span></div>
      <p className="text-sm">{item.environment === "production" ? "Produção" : "Homologação — sem valor fiscal"} · {item.createdAt}</p>
      {kind === "inutilizacao" && <p>Faixa: {item.request.first} a {item.request.last}</p>}
      {item.accessKey && <p className="break-all text-sm">Chave: {item.accessKey}</p>}
      {item.request.text && <p className="break-words whitespace-pre-wrap text-sm">{item.request.text}</p>}
      {(item.result.code || item.result.reason) && <p className="break-words text-sm">Retorno: {item.result.code} {item.result.reason}</p>}
      {item.result.protocol && <p className="break-all text-sm">Protocolo: {item.result.protocol}</p>}
      {item.documentId && <Link href={`/fiscal/notas-saida/${item.documentId}`} className="inline-flex min-h-11 items-center text-sm text-primary underline">Abrir NF-e e seus eventos</Link>}
    </article>)}</div>
    {page?.cursor && <Button variant="outline" disabled={loading} onClick={()=>{setLoading(true);setRequest({cursor:page.cursor!})}}>Carregar mais eventos</Button>}
  </main>
}
