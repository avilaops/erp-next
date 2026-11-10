import { Suspense } from "react"
import { PosAccess } from "@/features/pos/pos-access"
export default function Page() { return <Suspense fallback={<p role="status">Carregando histórico…</p>}><PosAccess view="history" /></Suspense> }

export const metadata = { title: "Histórico do PDV" }
