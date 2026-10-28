import { connection } from "next/server"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/components/workspace-access"
import { PageHeader } from "@/components/page-header"
import { Orders } from "./orders"
import { Receivables } from "./receivables"

export async function OperationsAccess({ area, id, create = false, edit = false }: { area: "orders" | "receivables"; id?: string; create?: boolean; edit?: boolean }) {
  await connection()
  const access = await currentWorkspaceAccess()
  const title = area === "orders" ? "Pedidos de venda" : "Contas a receber"
  return <div className="mx-auto w-full min-w-0 max-w-[1600px] px-4 pb-24 pt-6 sm:px-6">
    {!access.session ? <><PageHeader eyebrow={area === "orders" ? "Vendas" : "Financeiro"} title={title} description="Operações da empresa ativa." /><WorkspaceAccessNotice state={access.state} /></> : area === "orders" ? <Orders id={id} create={create} edit={edit} /> : <Receivables id={id} />}
  </div>
}
