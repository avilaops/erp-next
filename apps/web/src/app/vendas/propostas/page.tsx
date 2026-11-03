import { Suspense } from "react"
import { ProposalsAccess } from "@/features/sales/proposals-access"
export default function Page() { return <Suspense fallback={<p role="status">Carregando propostas…</p>}><ProposalsAccess /></Suspense> }

export const metadata = { title: "Propostas" }
