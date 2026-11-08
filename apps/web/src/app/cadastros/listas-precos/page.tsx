import { Suspense } from "react"
import { PriceListsAccess } from "@/features/price-lists/price-lists-access"
export const metadata = { title: "Listas de preços" }
export default function Page() { return <Suspense fallback={<p role="status">Carregando listas…</p>}><PriceListsAccess /></Suspense> }
