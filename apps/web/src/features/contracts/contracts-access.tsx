import { connection } from "next/server"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/components/workspace-access"
import { ContractDetail, ContractGenerator, ContractsList } from "./contracts"

export async function ContractsAccess({ id, orderId, customerId, generate = false }: { id?: string; orderId?: string; customerId?: string; generate?: boolean }) {
  await connection()
  const access = await currentWorkspaceAccess()
  return <div className="mx-auto w-full min-w-0 max-w-[1600px] px-4 pb-24 pt-6 sm:px-6">
    {!access.session ? <WorkspaceAccessNotice state={access.state} /> : id ? <ContractDetail key={id} id={id} /> : generate && orderId ? <ContractGenerator orderId={orderId} /> : <ContractsList orderId={orderId} customerId={customerId} />}
  </div>
}
