import { Suspense } from "react"
import { NfeDraftEditor } from "@/features/fiscal/nfe-draft-editor"

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p role="status">Carregando rascunho…</p>}><ResolvedDraft params={params} /></Suspense>
}

async function ResolvedDraft({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <NfeDraftEditor key={id} id={id} />
}
