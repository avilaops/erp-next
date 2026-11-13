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
    <PageHeader eyebrow="Operação comercial" title="Vendas" description="Consulte a tabela, negocie as condições e acompanhe as propostas e os pedidos da empresa ativa." actions={orders.value && <>
      <Link className={buttonVariants({ variant: "outline", className: "h-9 px-3" })} href="/vendas/tabela-precos">Tabela de preços</Link>
      {orders.value.canEdit && <Link className={buttonVariants({ className: "h-9 px-3" })} href="/vendas/pedidos/novo">Novo pedido</Link>}
    </>} />
    <div className="grid min-w-0 gap-6">
      <section className="min-w-0 space-y-3" aria-labelledby="sales-proposals-title">
        <h2 id="sales-proposals-title" className="text-sm font-semibold">Orçamentos e propostas</h2>
        {proposals.loading ? <p role="status">Carregando propostas…</p> : proposals.error ? <div role="alert"><RequestError message={proposals.error} status={proposals.status} /><Button variant="outline" onClick={proposals.reload}>Tentar consultar propostas novamente</Button></div> : proposals.value && <>
          <p className="text-xs text-muted-foreground">{proposals.value.total} proposta(s) cadastrada(s)</p>
          <div className="flex flex-wrap items-center gap-2 text-sm"><Link className={linkClass} href="/vendas/propostas">Consultar propostas</Link>{proposals.value.canEdit && <Link className={buttonVariants({ className: "h-9 px-3" })} href="/vendas/propostas/novo">Novo orçamento</Link>}</div>
          {proposals.value.data.length === 0 ? <p>Nenhuma proposta cadastrada nesta empresa.</p> : <div className="max-w-full overflow-x-auto rounded-lg border" role="region" aria-label="Propostas recentes" tabIndex={0}>
            <DataTable className="table-fixed text-xs sm:table-auto sm:text-sm"><caption className="sr-only">Propostas recentes</caption>
              <thead className="bg-primary text-primary-foreground"><tr><th scope="col" className="w-[64%] p-2 sm:w-auto sm:p-3">Cliente</th><th scope="col" className="hidden p-3 sm:table-cell">Situação</th><th scope="col" className="w-[36%] p-2 text-right sm:w-auto sm:p-3">Valor</th></tr></thead>
              <tbody>{proposals.value.data.map(proposal => <tr key={proposal.id} className="border-t hover:bg-muted/30">
                <td className="min-w-0 p-2 align-top sm:p-3"><Link className={`${linkClass} line-clamp-2 break-words [overflow-wrap:anywhere] sm:line-clamp-none`} title={proposal.customerName} href={`/vendas/propostas/${proposal.id}`}>{proposal.customerName}</Link><p className="mt-1 text-xs text-muted-foreground sm:hidden">{proposal.expired ? "Expirada" : statuses[proposal.status] || proposal.status}</p></td>
                <td className="hidden whitespace-nowrap p-3 align-top sm:table-cell">{proposal.expired ? "Expirada" : statuses[proposal.status] || proposal.status}</td>
                <td className="whitespace-nowrap p-2 text-right align-top tabular-nums sm:p-3">{money(proposal.amount)}</td>
              </tr>)}</tbody>
            </DataTable>
          </div>}
        </>}
      </section>
      <section className="min-w-0 space-y-3" aria-labelledby="sales-orders-title">
        <h2 id="sales-orders-title" className="text-sm font-semibold">Pedidos de venda</h2>
        {orders.loading ? <p role="status">Carregando pedidos…</p> : orders.error ? <div role="alert"><RequestError message={orders.error} status={orders.status} /><Button variant="outline" onClick={orders.reload}>Tentar consultar pedidos novamente</Button></div> : orders.value && <>
          <p className="text-xs text-muted-foreground">{orders.value.total} pedido(s) cadastrado(s)</p>
          <div className="flex flex-wrap items-center gap-2 text-sm"><Link className={linkClass} href="/vendas/pedidos">Consultar pedidos</Link>{orders.value.canEdit && <Link className={buttonVariants({ variant: "outline", className: "h-9 px-3" })} href="/vendas/pedidos/novo?modo=catalogo">Pedido pelo catálogo</Link>}</div>
          {orders.value.data.length === 0 ? <p>Nenhum pedido cadastrado nesta empresa.</p> : <div className="max-w-full overflow-x-auto rounded-lg border" role="region" aria-label="Pedidos recentes" tabIndex={0}>
            <DataTable className="table-fixed text-xs sm:table-auto sm:text-sm"><caption className="sr-only">Pedidos recentes</caption>
              <thead className="bg-primary text-primary-foreground"><tr><th scope="col" className="hidden p-3 sm:table-cell">Pedido</th><th scope="col" className="w-[64%] p-2 sm:w-auto sm:p-3">Cliente</th><th scope="col" className="hidden p-3 sm:table-cell">Situação</th><th scope="col" className="w-[36%] p-2 text-right sm:w-auto sm:p-3">Valor</th></tr></thead>
              <tbody>{orders.value.data.map(order => <tr key={order.id} className="border-t hover:bg-muted/30">
                <td className="hidden whitespace-nowrap p-3 align-top sm:table-cell"><Link className={linkClass} href={`/vendas/pedidos/${order.id}`}>{order.number ? orderNumber(order.number) : "Consultar pedido"}</Link></td>
                <td className="min-w-0 p-2 align-top sm:p-3">
                  <Link className={`${linkClass} line-clamp-2 break-words [overflow-wrap:anywhere] sm:line-clamp-none`} title={order.customerName} href={`/vendas/pedidos/${order.id}`}>{order.customerName}</Link>
                  <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground sm:hidden"><Link className="underline underline-offset-4" href={`/vendas/pedidos/${order.id}`}>{order.number ? orderNumber(order.number) : "Consultar pedido"}</Link><span>{statuses[order.status] || order.status}</span></div>
                </td>
                <td className="hidden whitespace-nowrap p-3 align-top sm:table-cell">{statuses[order.status] || order.status}</td>
                <td className="whitespace-nowrap p-2 text-right align-top tabular-nums sm:p-3">{money(order.amount)}</td>
              </tr>)}</tbody>
            </DataTable>
          </div>}
        </>}
      </section>
    </div>
    <nav aria-label="Configuração comercial" className="mt-6 flex flex-wrap gap-4"><Link className={linkClass} href="/preferencias/vendas">Configurações de vendas</Link><Link className={linkClass} href="/financeiro/contas-receber">Contas a receber</Link></nav>
  </>
}
