"use client"

import { GuardedLink as Link } from "@/components/shell/navigation-guard"
import { PageHeader } from "@/components/page-header"
import { RequestError } from "@/components/feedback/session-recovery"
import { StatusBadge, EmptyState, ResponsiveTable, CurrencyCell, SortableTableHeader } from "@/components/workspace/list-layout"
import { useTableSort } from "@/components/workspace/use-table-sort"
import { DataTable } from "@/components/workspace/data-table"
import { orderNumber } from "./order-presentation"
import { Button, buttonVariants } from "@/components/ui/button"
import { useResource } from "@/hooks/use-operation"
import type { Schema } from "@/lib/api/types"
import { money } from "@/features/purchasing/purchase-types"

const statuses: Record<string, string> = { draft: "Rascunho", sent: "Enviada", accepted: "Aceita", rejected: "Rejeitada", cancelled: "Cancelada", superseded: "Substituída", confirmed: "Reservado", completed: "Concluído" }
const linkClass = "font-medium text-primary underline underline-offset-4"

export function SalesWorkspace() {
  const proposalSort = useTableSort(["customerName", "status", "amount"], { by: "", order: "asc" }, "proposals")
  const orderSort = useTableSort(["number", "customerName", "status", "amount"], { by: "", order: "asc" }, "orders")
  const proposals = useResource<Schema<"ProposalList">>(`/api/erp/proposals?limit=5&${proposalSort.query}`)
  const orders = useResource<Schema<"OrderList">>(`/api/erp/orders?limit=5&${orderSort.query}`)
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
          <ResponsiveTable label="Propostas recentes">
            <DataTable className="min-w-[40rem] text-sm"><caption className="sr-only">Propostas recentes</caption>
              <thead className="bg-primary text-primary-foreground"><tr><SortableTableHeader field="customerName" sort={proposalSort.sort} onSort={proposalSort.toggle} className="w-[64%] p-2 sm:w-auto sm:p-3">Cliente</SortableTableHeader><SortableTableHeader field="status" sort={proposalSort.sort} onSort={proposalSort.toggle} className="p-3">Situação</SortableTableHeader><SortableTableHeader field="amount" sort={proposalSort.sort} onSort={proposalSort.toggle} className="w-[36%] p-2 text-right sm:w-auto sm:p-3">Valor</SortableTableHeader></tr></thead>
              <tbody>{proposals.value.data.map(proposal => <tr key={proposal.id} className="border-t hover:bg-muted/30">
                <td className="min-w-0 p-2 align-top sm:p-3"><Link className={`${linkClass} line-clamp-2 break-words [overflow-wrap:anywhere] sm:line-clamp-none`} title={proposal.customerName} href={`/vendas/propostas/${proposal.id}`}>{proposal.customerName}</Link></td>
                <td className="whitespace-nowrap p-3 align-top"><StatusBadge tone={proposal.expired ? "warning" : proposal.status === "accepted" ? "success" : "neutral"}>{proposal.expired ? "Expirada" : statuses[proposal.status] || proposal.status}</StatusBadge></td>
                <CurrencyCell className="p-3 align-top">{money(proposal.amount)}</CurrencyCell>
              </tr>)}{!proposals.value.data.length && <tr><td colSpan={3}><EmptyState filtered={false} /></td></tr>}</tbody>
            </DataTable>
          </ResponsiveTable>
        </>}
      </section>
      <section className="min-w-0 space-y-3" aria-labelledby="sales-orders-title">
        <h2 id="sales-orders-title" className="text-sm font-semibold">Pedidos de venda</h2>
        {orders.loading ? <p role="status">Carregando pedidos…</p> : orders.error ? <div role="alert"><RequestError message={orders.error} status={orders.status} /><Button variant="outline" onClick={orders.reload}>Tentar consultar pedidos novamente</Button></div> : orders.value && <>
          <p className="text-xs text-muted-foreground">{orders.value.total} pedido(s) cadastrado(s)</p>
          <div className="flex flex-wrap items-center gap-2 text-sm"><Link className={linkClass} href="/vendas/pedidos">Consultar pedidos</Link>{orders.value.canEdit && <Link className={buttonVariants({ variant: "outline", className: "h-9 px-3" })} href="/vendas/pedidos/novo?modo=catalogo">Pedido pelo catálogo</Link>}</div>
          <ResponsiveTable label="Pedidos recentes">
            <DataTable className="min-w-[40rem] text-sm"><caption className="sr-only">Pedidos recentes</caption>
              <thead className="bg-primary text-primary-foreground"><tr><SortableTableHeader field="number" sort={orderSort.sort} onSort={orderSort.toggle} className="p-3">Pedido</SortableTableHeader><SortableTableHeader field="customerName" sort={orderSort.sort} onSort={orderSort.toggle} className="w-[64%] p-2 sm:w-auto sm:p-3">Cliente</SortableTableHeader><SortableTableHeader field="status" sort={orderSort.sort} onSort={orderSort.toggle} className="p-3">Situação</SortableTableHeader><SortableTableHeader field="amount" sort={orderSort.sort} onSort={orderSort.toggle} className="w-[36%] p-2 text-right sm:w-auto sm:p-3">Valor</SortableTableHeader></tr></thead>
              <tbody>{orders.value.data.map(order => <tr key={order.id} className="border-t hover:bg-muted/30">
                <td className="whitespace-nowrap p-3 align-top"><Link className={linkClass} href={`/vendas/pedidos/${order.id}`}>{order.number ? orderNumber(order.number) : "Consultar pedido"}</Link></td>
                <td className="min-w-0 p-2 align-top sm:p-3">
                  <Link className={`${linkClass} line-clamp-2 break-words [overflow-wrap:anywhere] sm:line-clamp-none`} title={order.customerName} href={`/vendas/pedidos/${order.id}`}>{order.customerName}</Link>

                </td>
                <td className="whitespace-nowrap p-3 align-top"><StatusBadge tone={order.status === "completed" ? "success" : "neutral"}>{statuses[order.status] || order.status}</StatusBadge></td>
                <CurrencyCell className="p-3 align-top">{money(order.amount)}</CurrencyCell>
              </tr>)}{!orders.value.data.length && <tr><td colSpan={4}><EmptyState filtered={false} /></td></tr>}</tbody>
            </DataTable>
          </ResponsiveTable>
        </>}
      </section>
    </div>
    <nav aria-label="Configuração comercial" className="mt-6 flex flex-wrap gap-4"><Link className={linkClass} href="/preferencias/vendas">Configurações de vendas</Link><Link className={linkClass} href="/financeiro/contas-receber">Contas a receber</Link></nav>
  </>
}
