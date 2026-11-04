import { connection } from "next/server"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"
import { PageHeader } from "@/components/page-header"
import { SalesWorkspace } from "@/features/sales/sales-workspace"

export default async function Page() {
  await connection()
  const access = await currentWorkspaceAccess()
  return <div className="mx-auto w-full min-w-0 max-w-[1600px] px-4 pb-24 pt-6 sm:px-6">
    {access.session ? <SalesWorkspace /> : <><PageHeader eyebrow="Operação comercial" title="Vendas" description="Orçamentos e pedidos da empresa ativa." /><WorkspaceAccessNotice state={access.state} /></>}
  </div>
}

export const metadata = { title: "Vendas" }
