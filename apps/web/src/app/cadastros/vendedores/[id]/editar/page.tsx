import { Suspense } from "react"
import { StaffAccess } from "@/features/staff/staff-access"
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p role="status">Carregando cadastro…</p>}><Resolved params={params} /></Suspense>
}
async function Resolved({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <StaffAccess kind="vendedores" editor id={id} />
}

export const metadata = { title: "Editar vendedor" }
