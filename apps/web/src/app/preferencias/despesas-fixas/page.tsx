import { FixedExpenses } from "@/features/commercial-settings/fixed-expenses"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"

export const metadata = { title: "Despesas fixas · Avila ERP" }
export default async function Page() {
  const access = await currentWorkspaceAccess()
  return access.session ? <FixedExpenses /> : <WorkspaceAccessNotice state={access.state} />
}
