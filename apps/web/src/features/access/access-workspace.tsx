import { connection } from "next/server"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"
import { UsersManager } from "./users-manager"
import { RolesManager } from "./roles-manager"
import { MemberEditor } from "./member-editor"
import { InvitationEditor } from "./invitation-editor"

export async function AccessWorkspace({ view, memberId }: { view: "users" | "roles" | "member" | "invite"; memberId?: string }) {
  await connection()
  const access = await currentWorkspaceAccess()
  if (!access.session) return <WorkspaceAccessNotice state={access.state} />
  if (view === "invite") return <InvitationEditor />
  if (view === "member" && memberId) return <MemberEditor key={memberId} memberId={memberId} />
  return view === "roles" ? <RolesManager /> : <UsersManager />
}
