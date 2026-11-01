import { connection } from "next/server"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"
import { PageHeader } from "@/components/page-header"
import { StaffEditor, StaffList, type StaffKind } from "./staff-workspace"

export async function StaffAccess({ kind, editor = false, id, view = false }: { kind: StaffKind; editor?: boolean; id?: string; view?: boolean }) {
  await connection()
  const access = await currentWorkspaceAccess()
  return <div className="mx-auto w-full min-w-0 max-w-[1600px] px-4 pb-24 pt-6 sm:px-6">
    {!access.session ? <><PageHeader eyebrow="Cadastros" title={kind === "funcionarios" ? "Funcionários" : "Vendedores"} description="Equipe da empresa ativa." /><WorkspaceAccessNotice state={access.state} /></> : editor ? <StaffEditor key={`${kind}-${id || "new"}-${view}`} kind={kind} id={id} view={view} /> : <StaffList key={kind} kind={kind} />}
  </div>
}
