import { connection } from "next/server"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"
import { PageHeader } from "@/components/page-header"
import { Proposals } from "./proposals"

export async function ProposalsAccess({ id, create = false, edit = false }: { id?: string; create?: boolean; edit?: boolean }) {
  await connection()
  const access = await currentWorkspaceAccess()
  return <div className="mx-auto w-full min-w-0 max-w-[1600px] px-4 pb-24 pt-6 sm:px-6">
    {!access.session ? <><PageHeader eyebrow="Vendas" title="Propostas comerciais" description="Propostas da empresa ativa." /><WorkspaceAccessNotice state={access.state} /></> : <Proposals id={id} create={create} edit={edit} />}
  </div>
}
