import { connection } from "next/server"
import { PageHeader } from "@/components/page-header"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"
import { StockWorkspace } from "./stock-workspace"

export async function StockAccess() {
  await connection()
  const access = await currentWorkspaceAccess()
  if (!access.session) return <div className="mx-auto w-full min-w-0 max-w-[1600px] px-4 pb-24 pt-6 sm:px-6">
    <PageHeader eyebrow="Estoque" title="Saldos e movimentos" description="Estoque da empresa ativa." />
    <WorkspaceAccessNotice state={access.state} />
  </div>
  return <StockWorkspace />
}
