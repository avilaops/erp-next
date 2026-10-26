"use client"

import Link from "next/link"
import { useState } from "react"
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, PlugZap, RefreshCw, ShieldAlert, Unplug } from "lucide-react"
import { Button } from "@/components/ui/button"
import { type Integration, integrationStatusLabels } from "./integration-data"

type Health = "healthy" | "degraded" | "error" | "forbidden"

export function IntegrationDetail({ integration }: { integration: Integration }) {
  const initialHealth: Health = integration.status === "error" ? "error" : integration.status === "attention" ? "degraded" : "healthy"
  const [health, setHealth] = useState<Health>(initialHealth)
  const [testing, setTesting] = useState(false)
  const [tested, setTested] = useState(false)

  function testConnection() { setTesting(true); setTested(false); window.setTimeout(() => { setTesting(false); setTested(true) }, 650) }
  if (health === "forbidden") return <div className="mx-auto max-w-3xl px-4 py-16"><State icon={ShieldAlert} title="Sem permissão" description="Você não pode consultar os detalhes desta integração." /><Button variant="outline" onClick={() => setHealth(initialHealth)}>Voltar à simulação</Button></div>

  return <div className="mx-auto max-w-5xl px-4 pb-24 pt-8 lg:px-6">
    <Link className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" href="/preferencias/integracoes"><ArrowLeft className="size-4" />Integrações</Link>
    <header className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 text-sm font-medium text-primary">Preferências / Integrações</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{integration.name}</h1><p className="mt-3 text-sm text-muted-foreground">{integration.purpose}</p></div><label className="grid gap-1 text-xs text-muted-foreground">Simular saúde<select className="h-9 rounded-lg border border-input bg-background px-3 text-sm" value={health} onChange={(event) => { setHealth(event.target.value as Health); setTested(false) }}><option value="healthy">Saudável</option><option value="degraded">Degradada</option><option value="error">Erro</option><option value="forbidden">Sem permissão</option></select></label></header>
    <section className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-5"><div className="rounded-2xl border border-border bg-card p-5 sm:p-6"><div className="flex items-start gap-3"><span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><PlugZap className="size-5" /></span><div className="flex-1"><h2 className="font-semibold">Estado da conexão</h2><p className="mt-1 text-sm text-muted-foreground">{integrationStatusLabels[integration.status]} · {integration.account}</p></div></div><div className="mt-5"><HealthState health={health} /></div>{tested && <p className="mt-4 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400" role="status"><CheckCircle2 className="size-4" />Teste local concluído. Nenhuma requisição externa foi feita.</p>}<div className="mt-5 flex flex-wrap gap-2"><Button onClick={testConnection} disabled={testing}><RefreshCw className={testing ? "animate-spin" : ""} />{testing ? "Testando" : "Testar conexão"}</Button><Button variant="outline" disabled>Reconectar</Button></div></div>
        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6"><h2 className="font-semibold">Capacidades</h2><ul className="mt-4 grid gap-3 sm:grid-cols-2">{integration.capabilities.map((capability) => <li className="flex items-center gap-2 rounded-xl border border-border p-3 text-sm" key={capability}><CheckCircle2 className="size-4 text-emerald-500" />{capability}</li>)}</ul></section>
        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6"><h2 className="font-semibold">Histórico resumido</h2><ol className="mt-4 space-y-4 text-sm"><li className="flex gap-3"><Clock3 className="mt-0.5 size-4 text-muted-foreground" /><div><strong>Sincronização consultada</strong><p className="mt-1 text-muted-foreground">{integration.lastSync}</p></div></li><li className="flex gap-3"><Clock3 className="mt-0.5 size-4 text-muted-foreground" /><div><strong>Conexão configurada</strong><p className="mt-1 text-muted-foreground">Evento demonstrativo, sem credenciais.</p></div></li></ol></section>
      </div>
      <aside className="space-y-4"><div className="rounded-2xl border border-border bg-card p-5"><h2 className="font-semibold">Conta externa</h2><p className="mt-2 text-sm text-muted-foreground">{integration.account}</p><p className="mt-4 text-xs leading-5 text-muted-foreground">Tokens, cabeçalhos e payloads não são disponibilizados nesta interface.</p></div>{integration.safeError && <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5"><h2 className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4 text-amber-500" />Último alerta seguro</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{integration.safeError}</p></div>}</aside>
    </section>
  </div>
}

function HealthState({ health }: { health: Exclude<Health, "forbidden"> }) { const map = { healthy: { icon: CheckCircle2, title: "Conexão saudável", text: "O último estado conhecido não indica falhas.", style: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" }, degraded: { icon: AlertTriangle, title: "Conexão degradada", text: "A sincronização pode exigir nova autorização.", style: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400" }, error: { icon: Unplug, title: "Conexão com erro", text: "A comunicação falhou sem expor detalhes sensíveis.", style: "border-destructive/20 bg-destructive/10 text-destructive" } }[health]; const Icon = map.icon; return <div className={`flex gap-3 rounded-xl border p-4 ${map.style}`}><Icon className="mt-0.5 size-5 shrink-0" /><div><strong className="text-sm">{map.title}</strong><p className="mt-1 text-sm opacity-80">{map.text}</p></div></div> }
function State({ icon: Icon, title, description }: { icon: typeof PlugZap; title: string; description: string }) { return <div className="mb-5 text-center"><Icon className="mx-auto size-8 text-muted-foreground" /><h1 className="mt-4 text-xl font-semibold">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{description}</p></div> }
