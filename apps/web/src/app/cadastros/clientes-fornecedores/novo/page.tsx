import { Suspense } from "react"
import { PartyAccess } from "@/features/parties/party-access"
export default function Page() { return <Suspense fallback={<p role="status">Carregando cadastro…</p>}><PartyAccess editor /></Suspense> }
