import { connection } from "next/server"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/components/workspace-access"
import { PageHeader } from "@/components/page-header"
import { PartyEditor, PartyList } from "./party-workspace"

export async function PartyAccess({ editor = false, id, view = false }: { editor?: boolean; id?: string; view?: boolean }) {
  await connection()
  const access = await currentWorkspaceAccess()
  return <div className="mx-auto w-full min-w-0 max-w-[1600px] px-4 pb-24 pt-6 sm:px-6">
    {!access.session ? <>
      <PageHeader eyebrow="Cadastros" title="Clientes e fornecedores" description="Pessoas e empresas com relacionamento comercial." />
      <WorkspaceAccessNotice state={access.state} />
    </> : editor ? <PartyEditor key={`${id || "new"}-${view}`} id={id} view={view} /> : <PartyList />}
  </div>
}
