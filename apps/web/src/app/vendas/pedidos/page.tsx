import { Suspense } from "react"
import { OperationsAccess } from "@/features/operations/operations-access"
export default function Page() { return <Suspense fallback={<p role="status">Carregando pedidos…</p>}><OperationsAccess area="orders" /></Suspense> }
