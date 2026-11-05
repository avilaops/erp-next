import { PriceTables } from "@/features/commercial-settings/price-tables"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"

export const metadata = { title: "Tabela de preços · Avila ERP" }

export default async function Page() {
  const access = await currentWorkspaceAccess()
  return access.session ? <PriceTables /> : <WorkspaceAccessNotice state={access.state} />
}

