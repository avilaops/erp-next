import { Suspense } from "react"
import { PriceListsAccess } from "@/features/price-lists/price-lists-access"
export const metadata = { title: "Editar lista de preços" }
async function ResolvedPage({ params }: { params: Promise<{ id: string }> }) { return <PriceListsAccess id={(await params).id} edit /> }
export default function Page(props: Parameters<typeof ResolvedPage>[0]) { return <Suspense fallback={<p role="status">Carregando lista…</p>}><ResolvedPage {...props} /></Suspense> }
