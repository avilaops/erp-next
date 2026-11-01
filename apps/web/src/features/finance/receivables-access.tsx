import { connection } from "next/server"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"
import { PageHeader } from "@/components/page-header"
import { Receivables } from "./receivables"

export async function ReceivablesAccess({ id }: { id?: string }) {
  await connection()
  const access = await currentWorkspaceAccess()
  return <div className="mx-auto w-full min-w-0 max-w-[1600px] px-4 pb-24 pt-6 sm:px-6">
    {!access.session ? <><PageHeader eyebrow="Financeiro" title="Contas a receber" description="Operações da empresa ativa." /><WorkspaceAccessNotice state={access.state} /></> : <Receivables id={id} />}
  </div>
}
