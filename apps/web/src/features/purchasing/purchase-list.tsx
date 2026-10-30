"use client"

import { RequestError } from "@/components/session-recovery"

import Link from "next/link"
import { useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { useResource } from "@/features/operations/use-operation"
import { money, purchaseLabels, purchaseLink, type PurchaseList as Listing } from "./purchase-types"

export function PurchaseList({ receiving = false }: { receiving?: boolean }) {
  const [offset, setOffset] = useState(0)
  const result = useResource<Listing>(`/api/erp/purchase-orders?offset=${offset}&limit=25`)
  return <>
    <PageHeader eyebrow="Compras" title={receiving ? "Recebimentos de compras" : "Pedidos de compra"} description={receiving ? "Selecione uma compra para consultar os recebimentos e registrar a entrada dos produtos entregues." : "Compras da empresa ativa. O estoque e a conta a pagar são registrados no recebimento, não na criação do pedido."} />
    <section className="form-section min-w-0 space-y-4">
      <div className="flex flex-wrap gap-4">{result.value?.canEdit && <Link className={purchaseLink} href="/compras/pedidos/novo">Novo pedido de compra</Link>}<Link className={purchaseLink} href="/financeiro/contas-pagar">Contas a pagar</Link></div>
      {result.loading ? <p role="status">Carregando compras…</p> : result.error ? <div role="alert"><p><RequestError message={result.error} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button></div> : <>
        <p>{result.value?.total || 0} compra(s)</p>
        {!result.value?.data.length && <p>Nenhuma compra cadastrada neste módulo. Os documentos antigos preservados podem ser consultados no <Link className={purchaseLink} href="/historico">histórico importado</Link>.</p>}
        <ul className="grid min-w-0 gap-3 sm:grid-cols-2">{result.value?.data.map(order => <li className="min-w-0 space-y-2 rounded-xl border p-4" key={order.id}><Link className={`${purchaseLink} break-words`} href={`/compras/pedidos/${order.id}`}>Compra de {order.supplierName}</Link><p>{purchaseLabels[order.status] || order.status} · {money(order.amount)}</p><p>Vencimento: {order.dueDate}</p>{receiving && <p className="text-sm text-muted-foreground">Recebimentos e saldo disponível no detalhe da compra.</p>}</li>)}</ul>
        <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="outline" disabled={!offset} onClick={() => setOffset(value => value - 25)}>Anterior</Button><span>Página {Math.floor(offset / 25) + 1}</span><Button variant="outline" disabled={offset + 25 >= (result.value?.total || 0)} onClick={() => setOffset(value => value + 25)}>Próxima</Button></div>
      </>}
    </section>
  </>
}
