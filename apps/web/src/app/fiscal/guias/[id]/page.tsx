import { Suspense } from "react"
import { FiscalCapabilityUnavailable } from "@/features/fiscal/fiscal-screen"

export function generateStaticParams() {
  return [{ id: "GUIA-091" }]
}

async function ResolvedPage({ params }: { params: Promise<{ id: string }> }) {
  await params
  return <FiscalCapabilityUnavailable />
}

export const metadata = { title: "Detalhes da guia fiscal" }

export default function Page(props: Parameters<typeof ResolvedPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedPage {...props} /></Suspense>
}
