import { Suspense } from "react"
import { StaffAccess } from "@/features/staff/staff-access"
export default function Page() {
  return <Suspense fallback={<p role="status">Carregando cadastro…</p>}><StaffAccess kind="funcionarios" /></Suspense>
}
