import { connection } from "next/server"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/components/workspace-access"
import { Templates } from "./templates"
export async function TemplateWorkspace({ id }: { id?: string }) {
  await connection()
  const access = await currentWorkspaceAccess()
  return <div className="mx-auto max-w-6xl px-4 pb-24 pt-6">{access.session ? <Templates id={id} /> : <WorkspaceAccessNotice state={access.state} />}</div>
}
