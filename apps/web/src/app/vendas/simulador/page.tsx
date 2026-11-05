import { Suspense } from "react"
import { connection } from "next/server"
import { SalesSimulator } from "@/features/commercial-settings/simulator"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"

export const metadata = { title: "Simulador de preços · Ávila ERP" }
export default function Page() {
  return <Suspense fallback={<p role="status">Carregando simulador…</p>}><Resolved /></Suspense>
}
async function Resolved() {
  await connection()
  const access = await currentWorkspaceAccess()
  return access.session ? <SalesSimulator /> : <WorkspaceAccessNotice state={access.state} />
}
