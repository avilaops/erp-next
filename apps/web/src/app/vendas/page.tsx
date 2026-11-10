import { connection } from "next/server"
import { Suspense } from "react"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"
import { PageHeader } from "@/components/page-header"
import { SalesWorkspace } from "@/features/sales/sales-workspace"

export default function Page() {
  return <Suspense fallback={<p role="status">Carregando vendas…</p>}><SalesAccess /></Suspense>
}

async function SalesAccess() {
  await connection()
  const access = await currentWorkspaceAccess()
  return <div className="workspace-page-frame">
    {access.session ? <SalesWorkspace /> : <><PageHeader eyebrow="Operação comercial" title="Vendas" description="Orçamentos e pedidos da empresa ativa." /><WorkspaceAccessNotice state={access.state} /></>}
  </div>
}

export const metadata = { title: "Vendas" }
