import { NfeDraftEditor } from "@/features/fiscal/nfe-draft-editor"
import { Suspense } from "react"

export default function Page({ searchParams }: { searchParams: Promise<{ pedido?: string }> }) {
  return <Suspense fallback={<p role="status">Carregando preparação fiscal…</p>}><Preparation searchParams={searchParams} /></Suspense>
}

async function Preparation({ searchParams }: { searchParams: Promise<{ pedido?: string }> }) {
  const { pedido } = await searchParams
  return <NfeDraftEditor key={pedido || "manual"} sourceOrderId={pedido} />
}
