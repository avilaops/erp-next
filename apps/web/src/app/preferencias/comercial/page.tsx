import { Suspense } from "react"
import { CommercialSettings } from "@/features/commercial-settings/commercial-settings"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"

export const metadata = { title: "Parâmetros comerciais · Ávila ERP" }

export default async function Page() {
  const access = await currentWorkspaceAccess()
  return access.session ? <Suspense fallback={<p role="status">Carregando…</p>}><CommercialSettings /></Suspense> : <WorkspaceAccessNotice state={access.state} />
}
