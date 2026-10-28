import { Suspense } from "react"
import { PartyAccess } from "@/features/parties/party-access"
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p role="status">Carregando cadastro…</p>}><Resolved params={params} /></Suspense>
}
async function Resolved({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PartyAccess editor id={id} />
}
