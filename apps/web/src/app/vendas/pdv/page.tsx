import { Suspense } from "react"
import { PosAccess } from "@/features/pos/pos-access"
export default function Page() { return <Suspense fallback={<p role="status">Carregando PDV…</p>}><PosAccess view="sale" /></Suspense> }

export const metadata = { title: "PDV" }
