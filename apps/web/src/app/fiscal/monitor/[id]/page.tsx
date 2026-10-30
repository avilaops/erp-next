import { Suspense } from "react"
import { FiscalDocumentDetail } from "@/features/fiscal/fiscal-details"

export function generateStaticParams() {
  return [{ id: "1" }]
}

async function ResolvedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <FiscalDocumentDetail id={id} kind="received" />
}

export const metadata = { title: "Documento fiscal recebido" }

export default function Page(props: Parameters<typeof ResolvedPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedPage {...props} /></Suspense>
}
