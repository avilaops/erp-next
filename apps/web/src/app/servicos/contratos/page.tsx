import { Suspense } from "react"
import { ContractsAccess } from "@/features/contracts/contracts-access"
export default function Page() { return <Suspense fallback={<p role="status">Carregando contratos…</p>}><ContractsAccess /></Suspense> }
