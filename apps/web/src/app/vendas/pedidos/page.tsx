import { Suspense } from "react"
import { OrdersAccess } from "@/features/sales/orders-access"
export default function Page() { return <Suspense fallback={<p role="status">Carregando pedidos…</p>}><OrdersAccess /></Suspense> }

export const metadata = { title: "Pedidos de venda" }
