"use client"

import Link from "next/link"
import { useState } from "react"
import { useCommand, useResource } from "@/hooks/use-operation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

type CaseRow = { id: string; protocol: string; title: string; criticality: string; coverageStatus: string; status: string; serialNumber: string | null; lot: string | null; revision: number; updatedAt: string }
type CaseDetail = CaseRow & { description: string; timeline: { id: string; eventType: string; status: string; createdAt: string }[]; serviceOrders: unknown[]; parts: unknown[]; approvals: unknown[]; rmas: unknown[]; quarantines: unknown[] }
type CasesResponse = { tenantId: string; data: CaseRow[] }
type CaseResponse = { tenantId: string; data: CaseDetail }

const statusLabel: Record<string, string> = { opened: "Aberta", triage: "Triagem", diagnosis: "Diagnóstico", treatment: "Tratamento", resolved: "Resolvida", closed: "Encerrada", cancelled: "Cancelada" }

export function WarrantyList() {
  const cases = useResource<CasesResponse>("/api/erp/warranty-cases")
  const command = useCommand()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [criticality, setCriticality] = useState("normal")
  async function create() {
    if (!cases.value || title.trim().length < 3 || description.trim().length < 15) return
    const result = await command.send<{ tenantId: string }>("/api/erp/warranty-cases", cases.value.tenantId, { title, description, criticality })
    if (result) { setTitle(""); setDescription(""); setOpen(false); cases.reload() }
  }
  return <main className="mx-auto max-w-6xl space-y-5 px-4 pb-24 pt-8">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-6"><div><p className="text-sm font-medium text-primary">Vendas / Pós-venda</p><h1 className="mt-2 text-3xl font-semibold">Garantias e assistência técnica</h1><p className="mt-2 text-muted-foreground">Acompanhe elegibilidade, triagem, reparo, aprovação e encerramento por empresa.</p></div><Button onClick={() => setOpen(!open)}>{open ? "Cancelar" : "Nova garantia"}</Button></header>
    {open && <section className="space-y-4 rounded-2xl border p-5"><h2 className="font-semibold">Abrir solicitação</h2><label className="grid gap-2 text-sm">Título<Input value={title} onChange={e => setTitle(e.target.value)} /></label><label className="grid gap-2 text-sm">Descrição<Input value={description} onChange={e => setDescription(e.target.value)} /></label><label className="grid gap-2 text-sm">Criticidade<select className="h-10 rounded-lg border bg-background px-3" value={criticality} onChange={e => setCriticality(e.target.value)}><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label><Button disabled={command.busy || title.trim().length < 3 || description.trim().length < 15} onClick={() => void create()}>{command.busy ? "Salvando…" : "Abrir garantia"}</Button>{command.error && <p role="alert">{command.error}</p>}</section>}
    {cases.loading && <p role="status">Carregando garantias…</p>}
    {cases.error && <p role="alert">{cases.error}</p>}
    {cases.value && <section className="overflow-hidden rounded-2xl border"><div className="border-b p-4"><strong>{cases.value.data.length}</strong> solicitações registradas</div>{cases.value.data.length ? <div className="divide-y">{cases.value.data.map(item => <Link className="block p-4 hover:bg-muted/30" href={`/vendas/garantias/${item.id}`} key={item.id}><div className="flex flex-wrap justify-between gap-3"><div><strong>{item.protocol} · {item.title}</strong><p className="mt-1 text-sm text-muted-foreground">Criticidade: {item.criticality} · Atualizada em {new Date(item.updatedAt).toLocaleDateString("pt-BR")}</p></div><span className="text-sm font-medium">{statusLabel[item.status] || item.status}</span></div></Link>)}</div> : <p className="p-5 text-muted-foreground">Nenhuma solicitação registrada.</p>}</section>}
  </main>
}

export function WarrantyDetail({ id }: { id: string }) {
  const resource = useResource<CaseResponse>(`/api/erp/warranty-cases/${id}`)
  const command = useCommand()
  if (resource.loading) return <main className="p-6"><p role="status">Carregando garantia…</p></main>
  if (resource.error || !resource.value) return <main className="p-6"><p role="alert">{resource.error || "Garantia não encontrada"}</p></main>
  const item = resource.value.data
  const next = item.status === "opened" ? "triage" : item.status === "triage" ? "diagnosis" : item.status === "diagnosis" ? "treatment" : item.status === "treatment" ? "resolved" : item.status === "resolved" ? "closed" : ""
  async function transition() { if (!next) return; const result = await command.send(`/api/erp/warranty-cases/${id}/transition`, resource.value!.tenantId, { status: next, details: {} }, resource.etag); if (result) resource.reload() }
  return <main className="mx-auto max-w-6xl space-y-5 px-4 pb-24 pt-8"><Link className="text-sm text-muted-foreground underline" href="/vendas/garantias">Voltar para garantias</Link><header className="flex flex-wrap items-end justify-between gap-4 border-b pb-6"><div><p className="text-sm font-medium text-primary">{item.protocol}</p><h1 className="mt-2 text-3xl font-semibold">{item.title}</h1><p className="mt-2 text-muted-foreground">{item.description}</p></div>{next && <Button disabled={command.busy} onClick={() => void transition()}>{command.busy ? "Atualizando…" : `Avançar para ${statusLabel[next]}`}</Button>}</header><div className="grid gap-5 lg:grid-cols-2"><section className="rounded-2xl border p-5"><h2 className="mb-4 font-semibold">Resumo</h2><dl className="grid gap-4 sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">Situação</dt><dd>{statusLabel[item.status] || item.status}</dd></div><div><dt className="text-xs text-muted-foreground">Criticidade</dt><dd>{item.criticality}</dd></div><div><dt className="text-xs text-muted-foreground">Cobertura</dt><dd>{item.coverageStatus}</dd></div><div><dt className="text-xs text-muted-foreground">Revisão</dt><dd>{item.revision}</dd></div></dl></section><section className="rounded-2xl border p-5"><h2 className="mb-4 font-semibold">Linha do tempo</h2><ol className="space-y-3">{item.timeline.map(event => <li className="text-sm" key={event.id}>{event.eventType} · {statusLabel[event.status] || event.status}</li>)}</ol></section></div>{command.error && <p role="alert">{command.error}</p>}</main>
}
