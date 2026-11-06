import { NfeDraftEditor } from "@/features/fiscal/nfe-draft-editor"
import { Suspense } from "react"

export const metadata = { title: "Nova NF-e de saída" }

export default function Page({ searchParams }: { searchParams: Promise<{ pedido?: string; modelo?: string }> }) {
  return <Suspense fallback={<p role="status">Carregando preparação fiscal…</p>}><Preparation searchParams={searchParams} /></Suspense>
}

async function Preparation({ searchParams }: { searchParams: Promise<{ pedido?: string; modelo?: string }> }) {
  const { pedido, modelo } = await searchParams
  const initialModel = modelo === "65" ? 65 : 55
  return <NfeDraftEditor key={`${pedido || "manual"}-${initialModel}`} sourceOrderId={pedido} initialModel={initialModel} />
}
