import { Suspense } from "react"
import { ContractsAccess } from "@/features/contracts/contracts-access"
type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<{ contrato?: string | string[] }> }
export default function Page({ params, searchParams }: PageProps) {
  return <Suspense fallback={<p role="status">Carregando contratos…</p>}><Resolved params={params} searchParams={searchParams} /></Suspense>
}
async function Resolved({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const selected = typeof query.contrato === "string" && /^[a-f0-9-]{36}$/i.test(query.contrato) ? query.contrato : undefined
  return <ContractsAccess orderId={id} id={selected} />
}

export const metadata = { title: "Contratos do pedido" }
