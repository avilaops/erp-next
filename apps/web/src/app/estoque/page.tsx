import { Suspense } from "react"
import { StockAccess } from "@/features/inventory/stock-access"
export default function Page() { return <Suspense fallback={<p role="status">Carregando estoque…</p>}><StockAccess /></Suspense> }

export const metadata = { title: "Estoque" }
