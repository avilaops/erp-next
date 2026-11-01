import { connection } from "next/server"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"
import { CompanyEditor } from "./company-editor"
import { CompanySummary } from "./company-summary"

export async function CompanyWorkspace({ summary = false, partner = false }: { summary?: boolean; partner?: boolean }) {
  await connection()
  const access = await currentWorkspaceAccess()
  if (!access.session) return <WorkspaceAccessNotice state={access.state} />
  return summary ? <CompanySummary /> : <CompanyEditor partner={partner} />
}
