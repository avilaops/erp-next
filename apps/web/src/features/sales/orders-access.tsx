import { connection } from "next/server"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"
import { PageHeader } from "@/components/page-header"
import { Orders } from "./orders"
import { CommercialSimulator } from "./commercial-simulator"

export async function OrdersAccess({ id, create = false, edit = false, commercialCreate = false }: { id?: string; create?: boolean; edit?: boolean; commercialCreate?: boolean }) {
  await connection()
  const access = await currentWorkspaceAccess()
  return <div className="workspace-page-frame">
    {!access.session ? <><PageHeader eyebrow="Vendas" title="Pedidos de venda" description="Operações da empresa ativa." /><WorkspaceAccessNotice state={access.state} /></> : commercialCreate ? <CommercialSimulator initialLine="imported" initialProduct="" orderMode /> : <Orders id={id} create={create} edit={edit} />}
  </div>
}
