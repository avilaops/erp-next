import { Suspense } from "react"
import { OutgoingXmlImports } from "@/features/fiscal/outgoing-xml-imports"

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p role="status">Carregando XML…</p>}><Document params={params} /></Suspense>
}
async function Document({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <OutgoingXmlImports key={id} id={id} />
}
export const metadata = { title: "XML de saída importado" }
