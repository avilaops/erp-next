"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, BarChart3, ClipboardList, FileCheck2, FileText, HandCoins, Search, ShieldAlert } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { erpFetch } from "@/lib/api/client"
import { apiErrorMessage } from "@/lib/api/error-message"

const shortcuts = [
  { href: "/servicos/contratos", label: "Contratos", detail: "Vigência e renovação", icon: FileCheck2 },
  { href: "/servicos/ordens", label: "Ordens de serviço", detail: "Execução e assistência", icon: ClipboardList },
  { href: "/servicos/cte", label: "CT-e", detail: "Documentos de transporte recebidos", icon: FileText },
  { href: "/servicos/notas", label: "Notas de serviço", detail: "Documentos recebidos", icon: FileText },
  { href: "/servicos/cobrancas", label: "Cobranças", detail: "Serviços elegíveis", icon: HandCoins },
  { href: "/servicos/relatorios", label: "Relatórios", detail: "Produtividade e custos", icon: BarChart3 },
] as const

export function ServicesOverview() {
  return (
    <Shell title="Serviços" description="Contratos, execução técnica, documentos fiscais recebidos e cobranças da empresa ativa.">
      <section className="mt-7">
        <h2 className="text-lg font-semibold">Operação</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shortcuts.map(({ icon: Icon, ...item }) => (
            <Link className="rounded-2xl border border-border bg-card p-5 transition hover:border-primary/40 hover:bg-muted/30" href={item.href} key={item.href}>
              <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" /></span>
              <strong className="mt-4 block">{item.label}</strong>
              <span className="mt-1 block text-sm text-muted-foreground">{item.detail}</span>
            </Link>
          ))}
        </div>
      </section>
    </Shell>
  )
}

type ServiceOrder = {
  id: string
  protocol: string
  title: string
  status: "open" | "scheduled" | "in_repair" | "awaiting_parts" | "completed" | "cancelled"
  diagnosis: string | null
  laborCents: number
}

export function ServiceOrdersList() {
  const [orders, setOrders] = useState<ServiceOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    erpFetch("/api/erp/warranty-service-orders?limit=50&offset=0", { signal: controller.signal })
      .then(async (response) => {
        const value = await response.json()
        if (!response.ok) throw new Error(value.title || "Ordens de serviço indisponíveis")
        setOrders(value.data || [])
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(apiErrorMessage(cause, "Ordens de serviço indisponíveis"))
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  return (
    <Shell back="/servicos" title="Ordens de serviço" description="Ordens vinculadas aos protocolos reais de garantia e assistência da empresa ativa.">
      {loading ? (
        <div className="mt-6 space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
      ) : error ? (
        <Empty icon={ShieldAlert} title="Não foi possível carregar" description={error} />
      ) : orders.length === 0 ? (
        <Empty icon={Search} title="Nenhuma ordem de serviço encontrada" description="As ordens aparecem aqui quando são abertas a partir de um protocolo de garantia." />
      ) : (
        <section className="mt-6 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {orders.map((order) => (
            <article className="grid gap-3 p-4 sm:grid-cols-[150px_minmax(0,1fr)_180px] sm:items-center" key={order.id}>
              <div><strong className="text-sm text-primary">{order.protocol}</strong><p className="text-xs text-muted-foreground">{order.id}</p></div>
              <div><h2 className="text-sm font-medium">{order.title}</h2><p className="text-sm text-muted-foreground">{order.diagnosis || "Diagnóstico pendente"} · {formatCurrency(order.laborCents)}</p></div>
              <span className="w-fit rounded-full bg-muted px-2.5 py-1 text-xs">{serviceOrderStatus(order.status)}</span>
            </article>
          ))}
        </section>
      )}
    </Shell>
  )
}

function serviceOrderStatus(status: ServiceOrder["status"]) {
  return { open: "Aberta", scheduled: "Agendada", in_repair: "Em reparo", awaiting_parts: "Aguardando peça", completed: "Concluída", cancelled: "Cancelada" }[status]
}

function formatCurrency(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function Shell({ title, description, back, children }: { title: string; description: string; back?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1500px] px-4 pb-24 pt-8 lg:px-6">
      {back && <Link className="mb-5 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" href={back}><ArrowLeft className="size-4" />Voltar</Link>}
      <PageHeader eyebrow="Serviços" title={title} description={description} />
      {children}
    </div>
  )
}

function Empty({ icon: Icon, title, description }: { icon: typeof Search; title: string; description: string }) {
  return <div className="grid min-h-72 place-items-center p-6 text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground"><Icon className="size-5" /></span><h2 className="mt-4 font-semibold">{title}</h2><p className="mt-2 text-sm text-muted-foreground">{description}</p></div></div>
}
