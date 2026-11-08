import { connection } from "next/server"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"
import { PageHeader } from "@/components/page-header"
import { PriceListsWorkspace } from "./price-lists-workspace"

export async function PriceListsAccess({ id, create, edit }: { id?: string; create?: boolean; edit?: boolean }) {
  await connection()
  const access = await currentWorkspaceAccess()
  return access.session ? <PriceListsWorkspace tenantId={access.session.tenantId} id={id} create={create} edit={edit} /> : <><PageHeader title="Listas de preços" /><WorkspaceAccessNotice state={access.state} /></>
}
