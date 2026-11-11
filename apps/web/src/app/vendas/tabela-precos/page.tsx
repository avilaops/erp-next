import { CommercialTable } from "@/features/sales/commercial-table"
import { Suspense } from "react"
export const metadata = { title: "Tabela de preços" }
export default function Page() { return <Suspense fallback={<p role="status">Carregando tabela de preços…</p>}><CommercialTable /></Suspense> }
