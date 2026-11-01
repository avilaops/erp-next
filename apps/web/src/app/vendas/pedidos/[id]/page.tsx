import { Suspense } from "react"
import { OrdersAccess } from "@/features/sales/orders-access"
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p role="status">Carregando pedido…</p>}><Resolved params={params} /></Suspense>
}
async function Resolved({ params }: { params: Promise<{ id: string }> }) {
  return <OrdersAccess id={(await params).id} />
}

export const metadata = { title: "Detalhes de pedido de venda" }
