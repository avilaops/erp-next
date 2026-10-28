import { Suspense } from "react"
import { OperationsAccess } from "@/features/operations/operations-access"
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p role="status">Carregando pedido…</p>}><Resolved params={params} /></Suspense>
}
async function Resolved({ params }: { params: Promise<{ id: string }> }) {
  return <OperationsAccess area="orders" id={(await params).id} />
}
