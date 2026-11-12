import { Suspense } from "react"
import { OrdersAccess } from "@/features/sales/orders-access"
type PageProps = { searchParams: Promise<{ modo?: string | string[] }> }
export default function Page(props: PageProps) { return <Suspense fallback={<p role="status">Carregando pedido…</p>}><NewOrder {...props} /></Suspense> }
async function NewOrder({ searchParams }: PageProps) {
  const params = await searchParams
  return <OrdersAccess create commercialCreate={params.modo !== "catalogo"} />
}

export const metadata = { title: "Novo pedido de venda" }
