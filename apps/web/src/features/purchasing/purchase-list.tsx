"use client"

import { RequestError } from "@/components/feedback/session-recovery"

import Link from "next/link"
import { useState } from "react"
import { DataTable } from "@/components/workspace/data-table"
import { Button, buttonVariants } from "@/components/ui/button"
import { Pagination } from "@/components/workspace/pagination"
import { useResource } from "@/hooks/use-operation"
import { money, purchaseLabels, purchaseLink, type PurchaseList as Listing } from "./purchase-types"

export function PurchaseList({ receiving = false }: { receiving?: boolean }) {
  const [offset, setOffset] = useState(0)
  const result = useResource<Listing>(`/api/erp/purchase-orders?offset=${offset}&limit=25`)
  return <>

    <section className="form-section min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2">{result.value?.canEdit && <Link className={buttonVariants()} href="/compras/pedidos/novo">Novo pedido de compra</Link>}<Link className={purchaseLink} href="/financeiro/contas-pagar">Contas a pagar</Link></div>
      {result.loading ? <p role="status">Carregando compras…</p> : result.error ? <div role="alert"><p><RequestError message={result.error} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button></div> : <>
        <p role="status" className="text-sm text-muted-foreground">{result.value?.total || 0} compra(s)</p>
        {!result.value?.data.length && <p>Nenhuma compra cadastrada neste módulo. Os documentos antigos preservados podem ser consultados no <Link className={purchaseLink} href="/historico">histórico importado</Link>.</p>}
        {result.value?.data.length ? <div className="workspace-list-scroll" role="region" aria-label="Lista de compras" tabIndex={0}>
          <DataTable aria-label="Pedidos de compra" className="table-fixed md:table-auto">
            <thead><tr><th scope="col" className="w-[60%] md:w-auto">Fornecedor</th><th scope="col" className="hidden md:table-cell">Situação</th><th scope="col" className="hidden md:table-cell">Vencimento</th><th scope="col" className="text-right">Valor</th></tr></thead>
            <tbody>{result.value.data.map(order => {
              const status = purchaseLabels[order.status] || order.status
              const dueDate = order.dueDate?.split("-").reverse().join("/") || "Não informado"
              return <tr key={order.id}>
                <th scope="row" className="align-top"><Link className={`${purchaseLink} [overflow-wrap:anywhere]`} href={`/compras/pedidos/${order.id}`}>Compra de {order.supplierName}</Link><p className="mt-1 text-xs font-normal text-muted-foreground md:hidden">{status} · Vence {dueDate}</p></th>
                <td className="hidden md:table-cell">{status}</td><td className="hidden md:table-cell">{dueDate}</td>
                <td className="text-right align-top tabular-nums [overflow-wrap:anywhere]">{money(order.amount)}</td>
              </tr>
            })}</tbody>
          </DataTable>
        </div> : null}
        {receiving && !!result.value?.data.length && <p className="text-sm text-muted-foreground">Consulte os recebimentos e o saldo disponível no detalhe da compra.</p>}
        <Pagination offset={offset} pageSize={25} total={result.value?.total || 0} loading={result.loading} onOffsetChange={setOffset} />
      </>}
    </section>
  </>
}
