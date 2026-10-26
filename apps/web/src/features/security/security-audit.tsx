"use client"

import { useMemo, useState } from "react"
import { AlertCircle, KeyRound, Laptop, LockKeyhole, Search, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

type ScreenState = "ready" | "loading" | "error" | "forbidden"
const events = [
  { id: 1, date: "2026-10-24", at: "24/10/2026 18:42", user: "Nicolas Ávila", action: "Atualizou", entity: "Empresa", detail: "Dados cadastrais da empresa" },
  { id: 2, date: "2026-10-24", at: "24/10/2026 17:10", user: "Mariana Costa", action: "Entrou", entity: "Sessão", detail: "Acesso por dispositivo reconhecido" },
  { id: 3, date: "2026-10-23", at: "23/10/2026 14:25", user: "Carlos Mendes", action: "Consultou", entity: "Financeiro", detail: "Relatório consolidado" },
]

export function SecurityAudit() {
  const [state, setState] = useState<ScreenState>("ready")
  const [query, setQuery] = useState("")
  const [action, setAction] = useState("all")
  const [user, setUser] = useState("all")
  const [entity, setEntity] = useState("all")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const filtered = useMemo(() => events.filter((event) => (action === "all" || event.action === action) && (user === "all" || event.user === user) && (entity === "all" || event.entity === entity) && (!startDate || event.date >= startDate) && (!endDate || event.date <= endDate) && `${event.user} ${event.entity} ${event.detail}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"))), [action, endDate, entity, query, startDate, user])

  if (state === "forbidden") return <State title="Acesso não autorizado" description="Solicite a permissão Consultar auditoria a um administrador." icon={LockKeyhole}><Button variant="outline" onClick={() => setState("ready")}>Voltar à demonstração</Button></State>

  return <div className="mx-auto max-w-[1400px] px-4 pb-24 pt-8 lg:px-6">
    <header className="flex flex-col gap-5 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-medium text-primary">Preferências / Segurança e auditoria</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Segurança e auditoria</h1><p className="mt-3 max-w-2xl text-muted-foreground">Consulte sessões, políticas e eventos seguros. Nenhuma ação altera autenticação sem backend.</p></div><label className="grid gap-1 text-xs text-muted-foreground">Simular estado<select className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground" value={state} onChange={(event) => setState(event.target.value as ScreenState)}><option value="ready">Conteúdo</option><option value="loading">Carregamento</option><option value="error">Erro</option><option value="forbidden">Sem permissão</option></select></label></header>
    <div className="mt-7 grid gap-6 lg:grid-cols-2">
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6"><div className="flex items-center gap-3"><Laptop className="size-5 text-primary" /><div><h2 className="font-semibold">Sessões recentes</h2><p className="text-sm text-muted-foreground">Somente leitura</p></div></div><div className="mt-5 space-y-3">{[{ device: "Windows · Edge", place: "Votuporanga, SP", when: "Sessão atual" }, { device: "Android · Chrome", place: "São José do Rio Preto, SP", when: "Ontem, 20:14" }].map((session) => <article className="rounded-xl border border-border p-4" key={session.device}><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-medium">{session.device}</h3><p className="mt-1 text-xs text-muted-foreground">{session.place} · IP 189.***.***.42</p></div><span className="text-xs text-muted-foreground">{session.when}</span></div><Button className="mt-3" disabled size="sm" variant="outline">Revogar indisponível</Button></article>)}</div></section>
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6"><div className="flex items-center gap-3"><ShieldCheck className="size-5 text-primary" /><div><h2 className="font-semibold">Políticas de autenticação</h2><p className="text-sm text-muted-foreground">Gerenciadas pelo provedor de identidade</p></div></div><dl className="mt-5 divide-y divide-border">{[["MFA", "Recomendado; alteração indisponível"], ["Tempo de sessão", "8 horas"], ["Tentativas de acesso", "Bloqueio progressivo"], ["Senha", "Não armazenada pelo ERP"]].map(([term, value]) => <div className="flex justify-between gap-4 py-3 text-sm" key={term}><dt className="text-muted-foreground">{term}</dt><dd className="text-right font-medium">{value}</dd></div>)}</dl><div className="mt-4 flex gap-2 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground"><KeyRound className="mt-0.5 size-4 shrink-0" />Segredos e payloads de autenticação não são exibidos.</div></section>
    </div>
    <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card" aria-labelledby="audit-title"><div className="border-b border-border p-5"><h2 className="font-semibold" id="audit-title">Eventos de auditoria</h2><div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6"><label className="relative md:col-span-3 xl:col-span-2"><span className="sr-only">Buscar eventos</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Descrição do evento" value={query} onChange={(event) => setQuery(event.target.value)} /></label><AuditSelect label="Filtrar por usuário" value={user} onChange={setUser} options={["all", ...new Set(events.map((event) => event.user))]} /><AuditSelect label="Filtrar por ação" value={action} onChange={setAction} options={["all", "Atualizou", "Entrou", "Consultou"]} /><AuditSelect label="Filtrar por entidade" value={entity} onChange={setEntity} options={["all", ...new Set(events.map((event) => event.entity))]} /><div className="grid grid-cols-2 gap-2"><label><span className="sr-only">Data inicial</span><Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label><span className="sr-only">Data final</span><Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label></div></div></div>
      {state === "loading" && <div className="space-y-3 p-5">{[1, 2, 3].map((id) => <Skeleton className="h-16 w-full" key={id} />)}</div>}
      {state === "error" && <State title="Não foi possível carregar a auditoria" description="Tente novamente. Nenhum dado foi alterado." icon={AlertCircle}><Button onClick={() => setState("ready")}>Tentar novamente</Button></State>}
      {state === "ready" && filtered.length === 0 && <State title="Nenhum evento encontrado" description="Ajuste os filtros para consultar outros eventos." icon={Search}><Button variant="outline" onClick={() => { setQuery(""); setAction("all"); setUser("all"); setEntity("all"); setStartDate(""); setEndDate("") }}>Limpar filtros</Button></State>}
      {state === "ready" && filtered.length > 0 && <div className="divide-y divide-border">{filtered.map((event) => <article className="grid gap-2 p-4 text-sm sm:grid-cols-[150px_180px_110px_minmax(0,1fr)] sm:px-5" key={event.id}><time className="text-muted-foreground">{event.at}</time><strong>{event.user}</strong><span>{event.action}</span><span><span className="text-muted-foreground">{event.entity} · </span>{event.detail}</span></article>)}</div>}
    </section>
  </div>
}

function AuditSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label><span className="sr-only">{label}</span><select className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option === "all" ? label : option}</option>)}</select></label>
}

function State({ title, description, icon: Icon, children }: { title: string; description: string; icon: typeof Search; children?: React.ReactNode }) {
  return <div className="grid min-h-64 place-items-center p-6 text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted"><Icon className="size-5" /></span><h2 className="mt-4 font-semibold">{title}</h2><p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>{children && <div className="mt-5">{children}</div>}</div></div>
}
