import { Suspense } from "react"
import { TemplateWorkspace } from "@/features/contracts/template-workspace"
async function Editor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <TemplateWorkspace id={id} />
}
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p role="status">Carregando editor…</p>}><Editor params={params} /></Suspense>
}
export const metadata = { title: "Editar modelo de contrato" }
