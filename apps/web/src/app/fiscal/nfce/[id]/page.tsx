import { Suspense } from "react"
import { NfeDraftEditor } from "@/features/fiscal/nfe-draft-editor"

async function ResolvedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <NfeDraftEditor key={id} id={id} initialModel={65} />
}

export const metadata = { title: "Detalhes da NFC-e" }

export default function Page(props: Parameters<typeof ResolvedPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedPage {...props} /></Suspense>
}
