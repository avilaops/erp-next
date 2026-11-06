import { Suspense } from "react"
import { ReceivedDocumentDetail } from "@/features/fiscal/received-document-detail"

async function ResolvedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ReceivedDocumentDetail id={id} />
}

export const metadata = { title: "Documento fiscal recebido" }

export default function Page(props: Parameters<typeof ResolvedPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedPage {...props} /></Suspense>
}
