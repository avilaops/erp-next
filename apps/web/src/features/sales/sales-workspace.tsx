"use client"

import Link from "next/link"
import { PageHeader } from "@/components/page-header"
import { RequestError } from "@/components/feedback/session-recovery"
import { DataTable } from "@/components/workspace/data-table"
import { orderNumber } from "./order-presentation"
import { Button, buttonVariants } from "@/components/ui/button"
import { useResource } from "@/hooks/use-operation"
import type { Schema } from "@/lib/api/types"
import { money } from "@/features/purchasing/purchase-types"

const statuses: Record<string, string> = { draft: "Rascunho", sent: "Enviada", accepted: "Aceita", rejected: "Rejeitada", cancelled: "Cancelada", superseded: "Substituída", confirmed: "Reservado", completed: "Concluído" }
const linkClass = "font-medium text-primary underline underline-offset-4"

export function SalesWorkspace() {
  const proposals = useResource<Schema<"ProposalList">>("/api/erp/proposals?limit=5")
  const orders = useResource<Schema<"OrderList">>("/api/erp/orders?limit=5")
  return <>
    <PageHeader eyebrow="Operação comercial" title="Vendas" description="Prepare o orçamento, registre a decisão do cliente e acompanhe o pedido da empresa ativa." />
    <div className="grid min-w-0 gap-6">
      <section className="min-w-0 space-y-3" aria-labelledby="sales-proposals-title">
        <h2 id="sales-proposals-title" className="text-sm font-semibold">Orçamentos e propostas</h2>
        {proposals.loading ? <p role="status">Carregando propostas…</p> : proposals.error ? <div role="alert"><RequestError message={proposals.error} status={proposals.status} /><Button variant="outline" onClick={proposals.reload}>Tentar consultar propostas novamente</Button></div> : proposals.value && <>
          <p className="text-xs text-muted-foreground">{proposals.value.total} proposta(s) cadastrada(s)</p>
          <div className="flex flex-wrap items-center gap-2 text-sm"><Link className={linkClass} href="/vendas/propostas">Consultar propostas</Link>{proposals.value.canEdit && <Link className={buttonVariants({ className: "h-9 px-3" })} href="/vendas/propostas/novo">Novo orçamento</Link>}</div>
          {proposals.value.data.length === 0 ? <p>Nenhuma proposta cadastrada nesta empresa.</p> : <div className="max-w-full overflow-x-auto rounded-lg border" role="region" aria-label="Propostas recentes" tabIndex={0}><DataTable><caption className="sr-only">Propostas recentes</caption><thead className="bg-primary text-primary-foreground"><tr><th scope="col" className="p-3">Proposta</th><th scope="col" className="p-3">Cliente</th><th scope="col" className="p-3">Situação</th><th scope="col" className="p-3 text-right">Valor</th></tr></thead><tbody>{proposals.value.data.map(proposal => <tr key={proposal.id} className="border-t hover:bg-muted/30"><td className="whitespace-nowrap p-3"><Link className={linkClass} href={`/vendas/propostas/${proposal.id}`}>Proposta {proposal.number}</Link></td><td className="min-w-40 p-3">{proposal.customerName}</td><td className="whitespace-nowrap p-3">{proposal.expired ? "Expirada" : statuses[proposal.status] || proposal.status}</td><td className="whitespace-nowrap p-3 text-right tabular-nums">{money(proposal.amount)}</td></tr>)}</tbody></DataTable></div>}
        </>}
      </section>
      <section className="min-w-0 space-y-3" aria-labelledby="sales-orders-title">
        <h2 id="sales-orders-title" className="text-sm font-semibold">Pedidos de venda</h2>
        {orders.loading ? <p role="status">Carregando pedidos…</p> : orders.error ? <div role="alert"><RequestError message={orders.error} status={orders.status} /><Button variant="outline" onClick={orders.reload}>Tentar consultar pedidos novamente</Button></div> : orders.value && <>
          <p className="text-xs text-muted-foreground">{orders.value.total} pedido(s) cadastrado(s)</p>
          <div className="flex flex-wrap items-center gap-2 text-sm"><Link className={linkClass} href="/vendas/pedidos">Consultar pedidos</Link>{orders.value.canEdit && <Link className={buttonVariants({ className: "h-9 px-3" })} href="/vendas/pedidos/novo">Novo pedido</Link>}</div>
          {orders.value.data.length === 0 ? <p>Nenhum pedido cadastrado nesta empresa.</p> : <div className="max-w-full overflow-x-auto rounded-lg border" role="region" aria-label="Pedidos recentes" tabIndex={0}><DataTable><caption className="sr-only">Pedidos recentes</caption><thead className="bg-primary text-primary-foreground"><tr><th scope="col" className="p-3">Pedido</th><th scope="col" className="p-3">Cliente</th><th scope="col" className="p-3">Situação</th><th scope="col" className="p-3 text-right">Valor</th></tr></thead><tbody>{orders.value.data.map(order => <tr key={order.id} className="border-t hover:bg-muted/30"><td className="whitespace-nowrap p-3"><Link className={linkClass} href={`/vendas/pedidos/${order.id}`}>{order.number ? orderNumber(order.number) : "Consultar pedido"}</Link></td><td className="min-w-40 p-3"><Link className={linkClass} href={`/vendas/pedidos/${order.id}`}>{order.customerName}</Link></td><td className="whitespace-nowrap p-3">{statuses[order.status] || order.status}</td><td className="whitespace-nowrap p-3 text-right tabular-nums">{money(order.amount)}</td></tr>)}</tbody></DataTable></div>}
        </>}
      </section>
    </div>
    <nav aria-label="Configuração comercial" className="mt-6 flex flex-wrap gap-4"><Link className={linkClass} href="/preferencias/vendas">Configurações de vendas</Link><Link className={linkClass} href="/financeiro/contas-receber">Contas a receber</Link></nav>
  </>
}
