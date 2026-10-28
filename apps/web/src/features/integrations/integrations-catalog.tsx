"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { AlertCircle, ArrowRight, PlugZap, RefreshCw, Search, ShieldAlert, Unplug } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { integrations, integrationStatusLabels, type IntegrationStatus } from "./integration-data"

type ScreenState = "ready" | "loading" | "error" | "forbidden"

export function IntegrationsCatalog() {
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("all")
  const [status, setStatus] = useState<"all" | IntegrationStatus>("all")
  const [screenState, setScreenState] = useState<ScreenState>("ready")
  const filtered = useMemo(() => integrations.filter((item) => {
    const needle = query.trim().toLocaleLowerCase("pt-BR")
    return (!needle || `${item.name} ${item.purpose}`.toLocaleLowerCase("pt-BR").includes(needle)) && (category === "all" || item.category === category) && (status === "all" || item.status === status)
  }), [category, query, status])

  return <div className="mx-auto max-w-[1400px] px-4 pb-24 pt-8 lg:px-6">
    <header className="flex flex-col gap-5 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="mb-2 text-sm font-medium text-primary">Preferências / Integrações</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Integrações</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">Gerencie o acesso dos serviços à empresa. Novas chaves são exibidas uma única vez.</p></div>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">Simular estado<select className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground" value={screenState} onChange={(event) => setScreenState(event.target.value as ScreenState)}><option value="ready">Conteúdo</option><option value="loading">Carregamento</option><option value="error">Erro</option><option value="forbidden">Sem permissão</option></select></label>
    </header>
    <section className="mt-6 rounded-2xl border border-border bg-card p-5">
      <p className="text-xs text-muted-foreground">Fiscal</p><h2 className="mt-1 font-semibold">Lojas Ávila Ops</h2>
      <p className="mt-2 text-sm text-muted-foreground">Crie e revogue chaves de serviço da empresa. A configuração no Lojas é feita separadamente.</p>
      <Link className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary" href="/preferencias/integracoes/lojas">Gerenciar chaves<ArrowRight className="size-4" /></Link>
    </section>
    {screenState === "forbidden" ? <Panel icon={ShieldAlert} title="Acesso restrito" description="Você não possui permissão para consultar integrações desta empresa." /> : <section className="mt-7 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-[minmax(220px,1fr)_190px_190px] sm:p-5">
        <label className="relative"><span className="sr-only">Buscar integração</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="h-10 pl-9" placeholder="Buscar por nome ou finalidade" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <Select label="Filtrar categoria" value={category} onChange={setCategory} options={["all", "Vendas", "Financeiro", "Automação", "Comunicação"]} />
        <Select label="Filtrar estado" value={status} onChange={(value) => setStatus(value as "all" | IntegrationStatus)} options={["all", "connected", "disconnected", "attention", "error"]} statusLabels />
      </div>
      {screenState === "loading" ? <div className="grid gap-4 p-5 md:grid-cols-2">{Array.from({ length: 4 }, (_, index) => <Skeleton className="h-48 rounded-2xl" key={index} />)}</div> : screenState === "error" ? <Panel icon={AlertCircle} title="Não foi possível carregar as integrações" description="A falha desta simulação não expõe credenciais nem detalhes técnicos."><Button variant="outline" onClick={() => setScreenState("ready")}><RefreshCw />Tentar novamente</Button></Panel> : filtered.length === 0 ? <Panel icon={Unplug} title="Nenhuma integração encontrada" description="Ajuste a busca ou os filtros para ver outros serviços."><Button variant="outline" onClick={() => { setQuery(""); setCategory("all"); setStatus("all") }}>Limpar filtros</Button></Panel> : <div className="grid gap-4 p-4 md:grid-cols-2 sm:p-5">{filtered.map((item) => <article className="flex min-w-0 flex-col rounded-2xl border border-border bg-background p-5" key={item.provider}><div className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><PlugZap className="size-5" /></span><div className="min-w-0 flex-1"><h2 className="font-semibold">{item.name}</h2><p className="mt-1 text-sm text-muted-foreground">{item.purpose}</p></div><Status value={item.status} /></div><dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">Conta</dt><dd className="mt-1 truncate">{item.account}</dd></div><div><dt className="text-xs text-muted-foreground">Última sincronização</dt><dd className="mt-1">{item.lastSync}</dd></div></dl><Link className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted" href={`/preferencias/integracoes/${item.provider}`}>Ver detalhes<ArrowRight className="size-4" /></Link></article>)}</div>}
    </section>}
    <p className="mt-4 text-xs text-muted-foreground">Dados simulados. Conectar e desconectar permanecem indisponíveis até existir um contrato seguro de backend.</p>
  </div>
}

function Status({ value }: { value: IntegrationStatus }) { const style = { connected: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", disconnected: "text-muted-foreground bg-muted", attention: "bg-amber-500/10 text-amber-700 dark:text-amber-300", error: "text-destructive bg-destructive/10" }[value]; return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${style}`}>{integrationStatusLabels[value]}</span> }
function Select({ label, value, onChange, options, statusLabels = false }: { label: string; value: string; onChange: (value: string) => void; options: string[]; statusLabels?: boolean }) { return <label><span className="sr-only">{label}</span><select className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option === "all" ? label : statusLabels ? integrationStatusLabels[option as IntegrationStatus] : option}</option>)}</select></label> }
function Panel({ icon: Icon, title, description, children }: { icon: typeof PlugZap; title: string; description: string; children?: React.ReactNode }) { return <div className="grid min-h-64 place-items-center p-6 text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground"><Icon className="size-5" /></span><h2 className="mt-4 font-semibold">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>{children && <div className="mt-5 flex justify-center">{children}</div>}</div></div> }
