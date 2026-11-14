"use client"

import { RequestError } from "@/components/feedback/session-recovery"

import { GuardedLink as Link } from "@/components/shell/navigation-guard"
import { useRouter, useSearchParams } from "next/navigation"
import { EntityListPage, StatusBadge, EmptyState, ResponsiveTable, CurrencyCell, SortableTableHeader } from "@/components/workspace/list-layout"
import { useTableSort } from "@/components/workspace/use-table-sort"
import { DataTable } from "@/components/workspace/data-table"
import { Button, buttonVariants } from "@/components/ui/button"
import { Pagination } from "@/components/workspace/pagination"
import { useResource } from "@/hooks/use-operation"
import { money, purchaseLabels, purchaseLink, type PurchaseList as Listing } from "./purchase-types"

export function PurchaseList({ receiving = false }: { receiving?: boolean }) {
  const router = useRouter()
  const url = useSearchParams()
  const offsetValue = Number(url.get("offset") || 0)
  const offset = Number.isSafeInteger(offsetValue) && offsetValue >= 0 && offsetValue <= 100000 ? Math.floor(offsetValue / 25) * 25 : 0
  const { sort, toggle, query: sortQuery } = useTableSort(["supplierName", "status", "dueDate", "amount"], { by: "", order: "asc" })
  function navigate(patch: Record<string, string | number>) {
    const next = new URLSearchParams(window.location.search)
    for (const [key, value] of Object.entries(patch)) { if (String(value)) next.set(key, String(value)); else next.delete(key) }
    router.push(`${window.location.pathname}?${next}${window.location.hash}`, { scroll: false })
  }

  const result = useResource<Listing>(`/api/erp/purchase-orders?offset=${offset}&limit=25&${sortQuery}`)
  const createAction = result.value?.canEdit && <Link className={buttonVariants()} href="/compras/pedidos/novo">Novo pedido de compra</Link>
  return <EntityListPage title={receiving ? "Recebimentos de compras" : "Pedidos de compra"} actions={<>{createAction}<Link className={purchaseLink} href="/financeiro/contas-pagar">Contas a pagar</Link></>} summary={!result.loading && !result.error && (<p role="status" className="text-sm text-muted-foreground">{result.value?.total || 0} compra(s)</p>)} footer={!result.loading && !result.error && (<Pagination offset={offset} pageSize={25} total={result.value?.total || 0} loading={result.loading} onOffsetChange={offset => navigate({ offset })} />)}>
      {result.loading ? <p role="status">Carregando compras…</p> : result.error ? <div role="alert"><p><RequestError message={result.error} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button></div> : <>
        <ResponsiveTable label="Lista de compras">
          <DataTable aria-label="Pedidos de compra" className="min-w-[44rem]">
            <thead><tr><SortableTableHeader field="supplierName" sort={sort} onSort={toggle} className="w-[60%] md:w-auto">Fornecedor</SortableTableHeader><SortableTableHeader field="status" sort={sort} onSort={toggle} className="">Situação</SortableTableHeader><SortableTableHeader field="dueDate" sort={sort} onSort={toggle} className="">Vencimento</SortableTableHeader><SortableTableHeader field="amount" sort={sort} onSort={toggle} className="text-right">Valor</SortableTableHeader></tr></thead>
            <tbody>{result.value?.data.map(order => {
              const status = purchaseLabels[order.status] || order.status
              const dueDate = order.dueDate?.split("-").reverse().join("/") || "Não informado"
              return <tr key={order.id}>
                <th scope="row" className="align-top"><Link className={`${purchaseLink} [overflow-wrap:anywhere]`} href={`/compras/pedidos/${order.id}`}>Compra de {order.supplierName}</Link></th>
                <td><StatusBadge tone={order.status === "cancelled" ? "neutral" : order.status === "received" || order.status === "closed" ? "success" : "info"}>{status}</StatusBadge></td><td>{dueDate}</td>
                <CurrencyCell className="align-top">{money(order.amount)}</CurrencyCell>
              </tr>
            })}{!result.value?.data.length && <tr><td colSpan={4}><EmptyState filtered={false} description="As compras cadastradas aparecerão aqui. Documentos antigos permanecem no histórico importado." action={<>{createAction}<Link className={purchaseLink} href="/historico">Consultar histórico importado</Link></>} /></td></tr>}</tbody>
          </DataTable>
        </ResponsiveTable>
        {receiving && !!result.value?.data.length && <p className="text-sm text-muted-foreground">Consulte os recebimentos e o saldo disponível no detalhe da compra.</p>}
      </>}
  </EntityListPage>
}
