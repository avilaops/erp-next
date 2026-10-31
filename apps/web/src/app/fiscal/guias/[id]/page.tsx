import { Suspense } from "react"
import { TaxGuideDetail } from "@/features/fiscal/fiscal-details"

export function generateStaticParams() {
  return [{ id: "GUIA-091" }]
}

async function ResolvedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <TaxGuideDetail id={id} />
}

export const metadata = { title: "Detalhes da guia fiscal" }

export default function Page(props: Parameters<typeof ResolvedPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedPage {...props} /></Suspense>
}
