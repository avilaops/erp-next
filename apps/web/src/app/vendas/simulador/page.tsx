import { SalesSimulator } from "@/features/commercial-settings/simulator"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"

export const metadata = { title: "Simulador de preços · Ávila ERP" }
export default async function Page() {
  const access = await currentWorkspaceAccess()
  return access.session ? <SalesSimulator /> : <WorkspaceAccessNotice state={access.state} />
}
