import { Suspense } from "react"
import { TemplateWorkspace } from "@/features/contracts/template-workspace"
export default function Page() { return <Suspense fallback={<p role="status">Carregando modelos…</p>}><TemplateWorkspace /></Suspense> }
export const metadata = { title: "Modelos de contrato" }
