"use client"

import Link from "next/link"
import { PageHeader } from "@/components/page-header"
import { RequestError } from "@/components/feedback/session-recovery"
import { Button } from "@/components/ui/button"
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
    <div className="mt-6 grid min-w-0 gap-5 lg:grid-cols-2">
      <section className="form-section min-w-0 space-y-4" aria-labelledby="sales-proposals-title">
        <h2 id="sales-proposals-title" className="text-xl font-semibold">Orçamentos e propostas</h2>
        {proposals.loading ? <p role="status">Carregando propostas…</p> : proposals.error ? <div role="alert"><RequestError message={proposals.error} status={proposals.status} /><Button variant="outline" onClick={proposals.reload}>Tentar consultar propostas novamente</Button></div> : proposals.value && <>
          <p>{proposals.value.total} proposta(s) cadastrada(s)</p>
          <div className="flex flex-wrap gap-4"><Link className={linkClass} href="/vendas/propostas">Consultar propostas</Link>{proposals.value.canEdit && <Link className={linkClass} href="/vendas/propostas/novo">Novo orçamento</Link>}</div>
          {proposals.value.data.length === 0 ? <p>Nenhuma proposta cadastrada nesta empresa.</p> : <ul className="divide-y" aria-label="Propostas recentes">{proposals.value.data.map(proposal => <li key={proposal.id} className="space-y-1 py-3"><Link className={`${linkClass} break-words`} href={`/vendas/propostas/${proposal.id}`}>Proposta {proposal.number} · {proposal.customerName}</Link><p>{proposal.expired ? "Expirada" : statuses[proposal.status] || proposal.status} · versão {proposal.version} · {money(proposal.amount)}</p></li>)}</ul>}
        </>}
      </section>
      <section className="form-section min-w-0 space-y-4" aria-labelledby="sales-orders-title">
        <h2 id="sales-orders-title" className="text-xl font-semibold">Pedidos de venda</h2>
        {orders.loading ? <p role="status">Carregando pedidos…</p> : orders.error ? <div role="alert"><RequestError message={orders.error} status={orders.status} /><Button variant="outline" onClick={orders.reload}>Tentar consultar pedidos novamente</Button></div> : orders.value && <>
          <p>{orders.value.total} pedido(s) cadastrado(s)</p>
          <div className="flex flex-wrap gap-4"><Link className={linkClass} href="/vendas/pedidos">Consultar pedidos</Link>{orders.value.canEdit && <Link className={linkClass} href="/vendas/pedidos/novo">Novo pedido</Link>}</div>
          {orders.value.data.length === 0 ? <p>Nenhum pedido cadastrado nesta empresa.</p> : <ul className="divide-y" aria-label="Pedidos recentes">{orders.value.data.map(order => <li key={order.id} className="space-y-1 py-3"><Link className={`${linkClass} break-words`} href={`/vendas/pedidos/${order.id}`}>{order.customerName}</Link><p>{statuses[order.status] || order.status} · {money(order.amount)}</p></li>)}</ul>}
        </>}
      </section>
    </div>
    <nav aria-label="Configuração comercial" className="mt-6 flex flex-wrap gap-4"><Link className={linkClass} href="/preferencias/vendas">Configurações de vendas</Link><Link className={linkClass} href="/financeiro/contas-receber">Contas a receber</Link></nav>
  </>
}
