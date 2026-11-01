import { Suspense } from "react"
import { OrdersAccess } from "@/features/sales/orders-access"
export default function Page() { return <Suspense fallback={<p role="status">Carregando pedido…</p>}><OrdersAccess create /></Suspense> }

export const metadata = { title: "Novo pedido de venda" }
