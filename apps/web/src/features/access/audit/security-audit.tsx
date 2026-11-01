"use client"

import type { Schema } from "@/lib/api/types"

import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/page-header"
import { AccessLink } from "@/components/feedback/session-recovery"
import { useResource } from "@/hooks/use-operation"
import { auditActions, auditAreas, auditActionLabel, auditAreaLabel, sortedOptions } from "./audit-labels"

type AuditEvent = Schema<"AuditEvent">
type AuditResponse = Schema<"AuditResponse">
const empty = { q: "", action: "", entity: "", startDate: "", endDate: "" }
const formatDate = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "UTC" })

export function SecurityAudit() {
  const [draft, setDraft] = useState(empty)
  const [filters, setFilters] = useState(empty)
  const [cursors, setCursors] = useState<string[]>([])
  const [validation, setValidation] = useState("")
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== ""))
  if (cursors.length) params.set("before", cursors[cursors.length - 1])
  const resource = useResource<AuditResponse>(`/api/erp/audit?${params}`)

  function apply(event: FormEvent) {
    event.preventDefault()
    if (draft.startDate && draft.endDate && draft.startDate > draft.endDate) {
      setValidation("Data final deve ser igual ou posterior à inicial."); return
    }
    setValidation(""); setCursors([]); setFilters({ ...draft })
    if (!cursors.length && JSON.stringify(draft) === JSON.stringify(filters)) resource.reload()
  }

  function clear() { setDraft(empty); setFilters(empty); setCursors([]); setValidation("") }

  return <div className="mx-auto max-w-6xl space-y-6 px-4 pb-28 pt-8 lg:px-6">
    <PageHeader eyebrow="Preferências / Segurança" title="Segurança e auditoria" description="Veja o que foi feito na empresa, quem realizou cada ação e quando ela aconteceu." />
    <div className="grid gap-6 md:grid-cols-2">
      <section className="form-section space-y-2"><h2 className="text-lg font-semibold">Dispositivos conectados</h2><p className="text-sm text-muted-foreground">A lista de dispositivos e a opção de encerrar acessos ainda não estão disponíveis aqui.</p></section>
      <section className="form-section space-y-2"><h2 className="text-lg font-semibold">Proteção da conta</h2><p className="text-sm text-muted-foreground">As configurações de senha e verificação em duas etapas são gerenciadas no Ávila Auth. O histórico abaixo mostra as atividades realizadas dentro do ERP.</p></section>
    </div>
    <section className="form-section space-y-5" aria-labelledby="audit-title">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="audit-title" className="text-lg font-semibold">Histórico de atividades</h2><p className="mt-1 text-sm text-muted-foreground">As atividades mais recentes aparecem primeiro. Datas e horários em UTC, 3 horas à frente de Brasília.</p></div><Button variant="outline" disabled={resource.loading} onClick={() => { setCursors([]); resource.reload() }}>Atualizar histórico</Button></div>
      <form onSubmit={apply} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1 text-sm">Responsável<Input maxLength={120} placeholder="Pesquisar pelo nome" value={draft.q} onChange={event => setDraft(previous => ({ ...previous, q: event.target.value }))} /></label>
        {([['action', 'Atividade', auditActions], ['entity', 'Área do sistema', auditAreas]] as const).map(([key, label, options]) => <label key={key} className="field">{label}<select value={draft[key]} onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))}><option value="">{key === "action" ? "Todas as atividades" : "Todas as áreas"}</option>{sortedOptions(options).map(([code, text]) => <option key={code} value={code}>{text}</option>)}</select></label>)}
        {([['startDate', 'Data inicial'], ['endDate', 'Data final']] as const).map(([key, label]) => <label key={key} className="grid gap-1 text-sm">{label}<Input type="date" value={draft[key]} onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))} /></label>)}
        <div className="flex flex-wrap items-end gap-2"><Button type="submit" disabled={resource.loading}>Aplicar filtros</Button><Button type="button" variant="outline" disabled={resource.loading} onClick={clear}>Limpar filtros</Button></div>
      </form>
      {validation && <p role="alert">{validation}</p>}
      {resource.loading && <p role="status">Carregando atividades…</p>}
      {!resource.loading && resource.error && <div role="alert" className="space-y-3"><h3 className="font-semibold">{resource.status === 403 ? "Acesso não autorizado" : "Não foi possível carregar a auditoria"}</h3><p>{resource.status === 403 ? "Solicite a permissão Consultar a trilha de auditoria da empresa a um administrador." : resource.error}</p>{resource.status === 401 ? <AccessLink /> : resource.status !== 403 && <Button variant="outline" onClick={resource.reload}>Tentar novamente</Button>}</div>}
      {!resource.loading && !resource.error && resource.value && <>
        {resource.value.data.length === 0 ? <p role="status" className="py-8 text-center text-muted-foreground">Nenhuma atividade encontrada para estes filtros.</p> : <ol className="divide-y divide-border">{resource.value.data.map(event => <li key={event.id} className="grid min-w-0 gap-3 py-5 text-sm sm:grid-cols-[180px_minmax(0,1fr)]"><time dateTime={event.occurredAt} className="text-muted-foreground">{formatDate.format(new Date(event.occurredAt))} UTC</time><div className="min-w-0 space-y-2 break-words"><p className="text-base font-semibold">{auditActionLabel(event.action)}</p><p className="text-muted-foreground">{event.actor ? <>Realizado por <span className="font-medium text-foreground">{event.actor}</span></> : "Atualização automática do sistema"}</p><p className="text-xs text-muted-foreground">{auditAreaLabel(event.entityType)}</p><details className="pt-1 text-xs text-muted-foreground"><summary className="w-fit cursor-pointer py-1 hover:text-foreground">Informações para o suporte</summary><dl className="mt-2 space-y-2 rounded-lg bg-muted/40 p-3"><div><dt>Código da atividade</dt><dd className="mt-1 break-all font-mono">{event.action}</dd></div><div><dt>Código da área</dt><dd className="mt-1 break-all font-mono">{event.entityType}</dd></div></dl></details></div></li>)}</ol>}
        <nav aria-label="Paginação da auditoria" className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="text-sm text-muted-foreground">Página {cursors.length + 1} · {resource.value.data.length} atividade(s)</p><div className="flex gap-2"><Button variant="outline" disabled={!cursors.length} onClick={() => setCursors(previous => previous.slice(0, -1))}>Anterior</Button><Button variant="outline" disabled={!resource.value.nextCursor} onClick={() => { const cursor = resource.value?.nextCursor; if (cursor) setCursors(previous => [...previous, cursor]) }}>Próxima</Button></div></nav>
      </>}
    </section>
  </div>
}
