import { Suspense } from "react"
import { OperationsAccess } from "@/features/operations/operations-access"
export default function Page() { return <Suspense fallback={<p role="status">Carregando contas…</p>}><OperationsAccess area="receivables" /></Suspense> }

export const metadata = { title: "Contas a receber" }
