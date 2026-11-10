import { connection } from "next/server"
import { PageHeader } from "@/components/page-header"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"
import { StockWorkspace } from "./stock-workspace"

export async function StockAccess() {
  await connection()
  const access = await currentWorkspaceAccess()
  if (!access.session) return <div className="workspace-page-frame">
    <PageHeader eyebrow="Estoque" title="Saldos e movimentos" description="Estoque da empresa ativa." />
    <WorkspaceAccessNotice state={access.state} />
  </div>
  return <StockWorkspace />
}
