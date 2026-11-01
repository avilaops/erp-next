"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Check,
  Clock3,
  CreditCard,
  ExternalLink,
  Grid2X2,
  Search,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

type EventStatus = "unread" | "urgent" | "read"
type EventItem = {
  id: string
  title: string
  summary: string
  agency: string
  deadline: string
  date: string
  status: EventStatus
}

const initialEvents: EventItem[] = [
  { id: "EVT-2026-013", title: "Mudança na emissão nacional de NFS-e", summary: "Revise o cadastro dos prestadores optantes pelo Simples Nacional.", agency: "RFB", deadline: "01/09/2026", date: "3 jul", status: "urgent" },
  { id: "EVT-2026-012", title: "Validação do código cBenef em São Paulo", summary: "Produtos com benefício fiscal exigirão o código compatível.", agency: "SEFAZ SP", deadline: "06/04/2026", date: "2 abr", status: "unread" },
  { id: "EVT-2026-011", title: "Novos grupos de validação de GTIN", summary: "Confira GTIN e NCM antes do próximo envio fiscal.", agency: "RFB", deadline: "01/10/2025", date: "16 set", status: "unread" },
  { id: "EVT-2026-010", title: "Contingência offline para NFC-e", summary: "Evento informativo arquivado na demonstração.", agency: "SEFAZ SP", deadline: "05/07/2024", date: "5 jul", status: "read" },
]

export function EventsCenter() {
  const [events, setEvents] = useState(initialEvents)
  const [tab, setTab] = useState<EventStatus | "all">("unread")
  const [query, setQuery] = useState("")
  const [state, setState] = useState<"ready" | "loading" | "empty" | "error" | "forbidden">("ready")
  const visible = useMemo(() => events.filter((event) => (tab === "all" || event.status === tab) && `${event.title} ${event.summary} ${event.agency}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"))), [events, query, tab])
  const counts = (status: EventStatus) => events.filter((event) => event.status === status).length

  return <WorkspaceShell eyebrow="Central de trabalho" title="Eventos fiscais e tributários" description="Acompanhe avisos demonstrativos por prioridade. Nenhuma fonte oficial é consultada.">
    <DemoNotice text="Eventos locais para validação do frontend. Prazos e conteúdos precisam ser confirmados em fontes oficiais." />
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Situação dos eventos">
        {(["unread", "urgent", "read", "all"] as const).map((item) => <Button key={item} role="tab" aria-selected={tab === item} variant={tab === item ? "default" : "outline"} onClick={() => setTab(item)}>{item === "unread" ? `Não lidos (${counts("unread")})` : item === "urgent" ? `Urgentes (${counts("urgent")})` : item === "read" ? `Lidos (${counts("read")})` : `Todos (${events.length})`}</Button>)}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><span className="sr-only">Pesquisar eventos</span><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar evento ou órgão" /></label>
        <select aria-label="Simular estado dos eventos" className="h-8 rounded-lg border border-input bg-background px-3 text-sm" value={state} onChange={(event) => setState(event.target.value as typeof state)}><option value="ready">Conteúdo</option><option value="loading">Carregamento</option><option value="empty">Vazio</option><option value="error">Erro</option><option value="forbidden">Sem permissão</option></select>
      </div>
    </div>
    <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-card">
      {state === "loading" ? <div className="space-y-3 p-5" aria-label="Carregando eventos">{[1,2,3].map((id) => <Skeleton className="h-28" key={id} />)}</div> : state === "error" ? <StatePanel title="Não foi possível carregar os eventos" action={() => setState("ready")} /> : state === "forbidden" ? <StatePanel title="Acesso aos eventos restrito" /> : state === "empty" || !visible.length ? <StatePanel title="Nenhum evento nesta seleção" action={() => { setState("ready"); setTab("all"); setQuery("") }} /> : <div className="divide-y divide-border">{visible.map((event) => <article className="grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_160px_auto] md:items-center" key={event.id}><div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${event.status === "urgent" ? "bg-red-500/10 text-red-600 dark:text-red-300" : event.status === "unread" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>{event.status === "urgent" ? "Urgente" : event.status === "unread" ? "Não lido" : "Lido"}</span><span className="text-xs text-muted-foreground">{event.date}</span></div><h2 className="mt-3 font-semibold">{event.title}</h2><p className="mt-1 text-sm text-muted-foreground">{event.summary}</p></div><dl className="grid gap-2 text-sm"><div><dt className="text-xs text-muted-foreground">Órgão</dt><dd>{event.agency}</dd></div><div><dt className="text-xs text-muted-foreground">Prazo</dt><dd>{event.deadline}</dd></div></dl><div className="flex flex-wrap gap-2 md:justify-end"><Button nativeButton={false} render={<Link href={`/eventos/${event.id}`} />} variant="outline">Ver detalhe</Button>{event.status !== "read" && <Button onClick={() => setEvents((current) => current.map((item) => item.id === event.id ? { ...item, status: "read" } : item))}><Check />Marcar como lido</Button>}</div></article>)}</div>}
    </section>
  </WorkspaceShell>
}

export function EventDetail({ id }: { id: string }) {
  const [read, setRead] = useState(false)
  const event = initialEvents.find((item) => item.id === id) ?? initialEvents[0]
  return <WorkspaceShell back="/eventos" eyebrow="Central de trabalho / Eventos" title={event.title} description="Detalhe demonstrativo para orientar a revisão interna antes de qualquer decisão fiscal." actions={<Button disabled={read} onClick={() => setRead(true)}><Check />{read ? "Marcado como lido" : "Marcar como lido"}</Button>}>
    <DemoNotice text="Este conteúdo não substitui orientação contábil nem consulta à legislação oficial." />
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"><Card title="Resumo"><p className="text-sm leading-6 text-muted-foreground">{event.summary} A equipe deve revisar cadastros, regras fiscais e documentos afetados antes do prazo indicado.</p><h3 className="mt-5 font-medium">Ações sugeridas</h3><ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground"><li>Validar o enquadramento com a contabilidade.</li><li>Revisar produtos, clientes e configurações fiscais.</li><li>Registrar a decisão em auditoria quando houver backend.</li></ul></Card><Card title="Referência"><Info label="Código" value={event.id} /><Info label="Órgão" value={event.agency} /><Info label="Prazo" value={event.deadline} /><Info label="Situação local" value={read ? "Lido nesta sessão" : "Pendente"} /></Card></div>
  </WorkspaceShell>
}

const notifications = [
  ["NOT-091", "Pedido PV-1048 aguarda aprovação", "Vendas", "Há 12 min", "Alta"],
  ["NOT-090", "Estoque abaixo do mínimo em 5 produtos", "Estoque", "Há 38 min", "Média"],
  ["NOT-089", "Conciliação do Banco empresarial pendente", "Financeiro", "Hoje, 08:20", "Média"],
] as const

export function NotificationsCenter() {
  const [read, setRead] = useState<string[]>([])
  return <WorkspaceShell eyebrow="Central de trabalho" title="Notificações" description="Pendências e alertas locais organizados por prioridade e módulo." actions={<Button variant="outline" onClick={() => setRead(notifications.map((item) => item[0]))}><Check />Marcar todas como lidas</Button>}><DemoNotice text="As notificações são demonstrativas e não são persistidas." /><div className="grid gap-3">{notifications.map(([id,title,module,time,priority]) => <article className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center" key={id}><span className={`grid size-10 shrink-0 place-items-center rounded-xl ${read.includes(id) ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}><Bell className="size-5" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong>{title}</strong><span className="rounded-full bg-muted px-2 py-0.5 text-xs">{priority}</span></div><p className="mt-1 text-sm text-muted-foreground">{module} · {time}</p></div><Button disabled={read.includes(id)} variant="outline" onClick={() => setRead((current) => [...current, id])}>{read.includes(id) ? "Lida" : "Marcar como lida"}</Button></article>)}</div></WorkspaceShell>
}


const apps = [
  ["Ávila Lojas", "Catálogo, pedidos e canais de venda", "Conectado", "/vendas/loja-virtual"],
  ["Monitor fiscal", "Documentos vinculados ao CNPJ", "Demonstração", "/fiscal/monitor"],
  ["Ávila Envios", "Cotações, etiquetas e rastreamento", "Demonstração", "/logistica/envios"],
  ["Conta Digital", "Cobranças, pagamentos e movimentos", "Planejado", "/financeiro/conta-digital"],
] as const

export function AppsCenter() {
  const [query, setQuery] = useState("")
  const visible = apps.filter((item) => item.join(" ").toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")))
  return <WorkspaceShell eyebrow="Ecossistema" title="Aplicativos e extensões" description="Centralize módulos próprios e integrações previstas sem instalar ou autorizar serviços externos."><DemoNotice text="Nenhum aplicativo é instalado e nenhuma credencial é solicitada nesta fase." /><label className="relative block max-w-md"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><span className="sr-only">Pesquisar aplicativos</span><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar aplicativo ou finalidade" /></label><div className="mt-5 grid gap-3 sm:grid-cols-2">{visible.map(([name,description,status,href]) => <article className="rounded-2xl border border-border bg-card p-5" key={name}><div className="flex items-start justify-between gap-3"><span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><Grid2X2 className="size-5" /></span><span className="rounded-full bg-muted px-2.5 py-1 text-xs">{status}</span></div><h2 className="mt-4 font-semibold">{name}</h2><p className="mt-2 text-sm text-muted-foreground">{description}</p><Button className="mt-5" nativeButton={false} render={<Link href={href} />} variant="outline">Abrir módulo<ExternalLink /></Button></article>)}</div></WorkspaceShell>
}

export function DigitalAccountWorkspace() {
  const [notice, setNotice] = useState("")
  return <WorkspaceShell eyebrow="Financeiro" title="Conta Digital" description="Visão demonstrativa de cobranças, pagamentos e movimentações conectadas ao ERP."><DemoNotice text="Nenhuma conta bancária foi aberta ou conectada. Valores e ações são somente ilustrativos." />{notice && <p className="mb-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm" role="status">{notice}</p>}<div className="grid gap-3 sm:grid-cols-3"><Metric label="Saldo demonstrativo" value="R$ 48.190,00" icon={WalletCards} /><Metric label="A receber hoje" value="R$ 12.840,00" icon={CreditCard} /><Metric label="Pendências" value="3" icon={Clock3} /></div><div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]"><Card title="Movimentações recentes"><div className="divide-y divide-border">{[["Recebimento PV-1047","+ R$ 7.240,00"],["Pagamento Aço Forte","- R$ 18.940,00"],["Tarifa demonstrativa","- R$ 18,90"]].map(([label,value]) => <div className="flex items-center justify-between gap-3 py-3 text-sm" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></Card><Card title="Ações"><div className="grid gap-2"><Button onClick={() => setNotice("Cobrança preparada somente nesta demonstração.")}>Preparar cobrança</Button><Button variant="outline" onClick={() => setNotice("Pagamento simulado; nenhum valor foi movimentado.")}>Simular pagamento</Button><Button variant="outline" nativeButton={false} render={<Link href="/financeiro/caixas-bancos" />}>Ver caixas e bancos</Button></div></Card></div></WorkspaceShell>
}

function WorkspaceShell({ eyebrow, title, description, back, actions, children }: { eyebrow: string; title: string; description: string; back?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return <div className="mx-auto max-w-[1450px] px-4 pb-24 pt-8 lg:px-6">{back && <Link className="mb-5 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" href={back}><ArrowLeft className="size-4" />Voltar</Link>}<header className="mb-7 flex flex-col gap-5 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-medium text-primary">{eyebrow}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1><p className="mt-3 max-w-3xl text-muted-foreground">{description}</p></div>{actions && <div className="flex flex-wrap gap-2">{actions}</div>}</header>{children}</div>
}
function DemoNotice({ text }: { text: string }) { return <div className="mb-6 flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-muted-foreground"><AlertTriangle className="size-5 shrink-0 text-amber-500" /><p>{text}</p></div> }
function Card({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-border bg-card p-5"><h2 className="font-semibold">{title}</h2><div className="mt-4">{children}</div></section> }
function Info({ label, value }: { label: string; value: string }) { return <div className="mb-4"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-medium">{value}</dd></div> }
function StatePanel({ title, action }: { title: string; action?: () => void }) { return <div className="grid min-h-64 place-items-center p-6 text-center"><div><ShieldCheck className="mx-auto size-6 text-muted-foreground" /><h2 className="mt-3 font-semibold">{title}</h2>{action && <Button className="mt-4" variant="outline" onClick={action}>Restaurar conteúdo</Button>}</div></div> }
function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Sparkles }) { return <div className="rounded-2xl border border-border bg-card p-5"><Icon className="size-5 text-primary" /><strong className="mt-4 block text-2xl">{value}</strong><span className="text-sm text-muted-foreground">{label}</span></div> }
