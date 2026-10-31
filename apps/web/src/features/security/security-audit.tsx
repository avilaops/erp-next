"use client"

import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/page-header"
import { AccessLink } from "@/components/session-recovery"
import { useResource } from "@/features/operations/use-operation"

type AuditEvent = { id: string; occurredAt: string; actor: string | null; action: string; entityType: string }
type AuditResponse = { tenantId: string; data: AuditEvent[]; nextCursor: string | null }
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
    <PageHeader eyebrow="Preferências / Segurança e auditoria" title="Segurança e auditoria" description="Consulte os eventos registrados pelo ERP para a empresa ativa. Esta tela não altera a autenticação." />
    <div className="grid gap-6 md:grid-cols-2">
      <section className="form-section space-y-2"><h2 className="text-lg font-semibold">Sessões e dispositivos</h2><p className="text-sm text-muted-foreground">A consulta e a revogação de sessões do provedor de identidade ainda não estão integradas nesta tela.</p></section>
      <section className="form-section space-y-2"><h2 className="text-lg font-semibold">Políticas de autenticação</h2><p className="text-sm text-muted-foreground">O estado atual das políticas do Auth não está disponível nesta tela. Eventos de auditoria do ERP não comprovam login, MFA ou duração de sessão.</p></section>
    </div>
    <section className="form-section space-y-5" aria-labelledby="audit-title">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="audit-title" className="text-lg font-semibold">Eventos de auditoria</h2><p className="mt-1 text-sm text-muted-foreground">25 eventos por página, do mais recente para o mais antigo. Datas e filtros em UTC. Dados internos dos eventos não são exibidos.</p></div><Button variant="outline" disabled={resource.loading} onClick={() => { setCursors([]); resource.reload() }}>Atualizar eventos</Button></div>
      <form onSubmit={apply} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {([['q', 'Buscar ação, tipo ou responsável'], ['action', 'Código exato da ação'], ['entity', 'Tipo exato de registro'], ['startDate', 'Data inicial (UTC)'], ['endDate', 'Data final (UTC)']] as const).map(([key, label]) => <label key={key} className="grid gap-1 text-sm">{label}<Input type={key.endsWith("Date") ? "date" : "text"} maxLength={120} placeholder={key === "action" ? "company.updated" : key === "entity" ? "company" : undefined} value={draft[key]} onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))} /></label>)}
        <div className="flex flex-wrap items-end gap-2"><Button type="submit" disabled={resource.loading}>Aplicar filtros</Button><Button type="button" variant="outline" disabled={resource.loading} onClick={clear}>Limpar filtros</Button></div>
      </form>
      {validation && <p role="alert">{validation}</p>}
      {resource.loading && <p role="status">Carregando eventos…</p>}
      {!resource.loading && resource.error && <div role="alert" className="space-y-3"><h3 className="font-semibold">{resource.status === 403 ? "Acesso não autorizado" : "Não foi possível carregar a auditoria"}</h3><p>{resource.status === 403 ? "Solicite a permissão Consultar a trilha de auditoria da empresa a um administrador." : resource.error}</p>{resource.status === 401 ? <AccessLink /> : resource.status !== 403 && <Button variant="outline" onClick={resource.reload}>Tentar novamente</Button>}</div>}
      {!resource.loading && !resource.error && resource.value && <>
        {resource.value.data.length === 0 ? <p role="status" className="py-8 text-center text-muted-foreground">Nenhum evento encontrado para estes filtros.</p> : <ol className="divide-y divide-border">{resource.value.data.map(event => <li key={event.id} className="grid min-w-0 gap-2 py-4 text-sm sm:grid-cols-[180px_minmax(0,1fr)]"><time dateTime={event.occurredAt} className="text-muted-foreground">{formatDate.format(new Date(event.occurredAt))} UTC</time><div className="min-w-0 space-y-1 break-words"><p className="font-medium">{event.actor ?? "Processo do sistema"}</p><p>Ação: <code>{event.action}</code></p><p className="text-muted-foreground">Tipo: <code>{event.entityType}</code></p></div></li>)}</ol>}
        <nav aria-label="Paginação da auditoria" className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="text-sm text-muted-foreground">Página {cursors.length + 1} · {resource.value.data.length} evento(s)</p><div className="flex gap-2"><Button variant="outline" disabled={!cursors.length} onClick={() => setCursors(previous => previous.slice(0, -1))}>Anterior</Button><Button variant="outline" disabled={!resource.value.nextCursor} onClick={() => { const cursor = resource.value?.nextCursor; if (cursor) setCursors(previous => [...previous, cursor]) }}>Próxima</Button></div></nav>
      </>}
    </section>
  </div>
}
