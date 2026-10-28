import { Suspense } from "react"
import { OperationsAccess } from "@/features/operations/operations-access"
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p role="status">Carregando conta…</p>}><Resolved params={params} /></Suspense>
}
async function Resolved({ params }: { params: Promise<{ id: string }> }) {
  return <OperationsAccess area="receivables" id={(await params).id} />
}
