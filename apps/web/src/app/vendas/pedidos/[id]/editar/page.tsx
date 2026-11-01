import { Suspense } from "react"
import { OrdersAccess } from "@/features/sales/orders-access"

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p role="status">Carregando rascunho…</p>}><Resolved params={params} /></Suspense>
}

async function Resolved({ params }: { params: Promise<{ id: string }> }) {
  return <OrdersAccess id={(await params).id} edit />
}

export const metadata = { title: "Editar pedido de venda" }
