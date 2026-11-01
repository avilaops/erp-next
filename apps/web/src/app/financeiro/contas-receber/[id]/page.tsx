import { Suspense } from "react"
import { ReceivablesAccess } from "@/features/finance/receivables-access"
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p role="status">Carregando conta…</p>}><Resolved params={params} /></Suspense>
}
async function Resolved({ params }: { params: Promise<{ id: string }> }) {
  return <ReceivablesAccess id={(await params).id} />
}

export const metadata = { title: "Detalhes de conta a receber" }
