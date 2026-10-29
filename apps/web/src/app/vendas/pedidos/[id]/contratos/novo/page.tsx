import { Suspense } from "react"
import { ContractsAccess } from "@/features/contracts/contracts-access"
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p role="status">Carregando modelos…</p>}><Resolved params={params} /></Suspense>
}
async function Resolved({ params }: { params: Promise<{ id: string }> }) { return <ContractsAccess orderId={(await params).id} generate /> }
