import { Suspense } from "react"
import { CommercialSettings } from "@/features/commercial-settings/commercial-settings"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"

export const metadata = { title: "Parâmetros comerciais · Avila ERP" }

export default function Page() {
  return <Suspense fallback={<p role="status">Carregando parâmetros…</p>}><CommercialAccess /></Suspense>
}

async function CommercialAccess() {
  const access = await currentWorkspaceAccess()
  return access.session ? <CommercialSettings /> : <WorkspaceAccessNotice state={access.state} />
}
