import { connection } from "next/server"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/components/workspace-access"
import { CompanyEditor } from "./company-editor"
import { CompanySummary } from "./company-summary"

export async function CompanyWorkspace({ summary = false }: { summary?: boolean }) {
  await connection()
  const access = await currentWorkspaceAccess()
  if (!access.session) return <WorkspaceAccessNotice state={access.state} />
  return summary ? <CompanySummary /> : <CompanyEditor />
}
