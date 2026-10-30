import { Suspense } from "react"
import { PartyAccess } from "@/features/parties/party-access"
export default function PeoplePage() { return <Suspense fallback={<p role="status">Carregando pessoas…</p>}><PartyAccess /></Suspense> }

export const metadata = { title: "Clientes e fornecedores" }
