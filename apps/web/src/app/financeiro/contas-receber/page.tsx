import { Suspense } from "react"
import { ReceivablesAccess } from "@/features/finance/receivables-access"
export default function Page() { return <Suspense fallback={<p role="status">Carregando contas…</p>}><ReceivablesAccess /></Suspense> }

export const metadata = { title: "Contas a receber" }
