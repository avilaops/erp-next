import { Suspense } from "react"
import { EventDetail } from "@/features/workspace/workspace-pages"

export function generateStaticParams() { return [{ id: "EVT-2026-013" }] }

async function ResolvedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <EventDetail id={id} />
}

export const metadata = { title: "Detalhes de evento" }

export default function Page(props: Parameters<typeof ResolvedPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedPage {...props} /></Suspense>
}
