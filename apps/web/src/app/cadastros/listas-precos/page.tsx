import { PriceTables } from "@/features/commercial-settings/price-tables"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"

export default async function PriceListsPage() {
  const access = await currentWorkspaceAccess()
  return access.session ? <PriceTables /> : <WorkspaceAccessNotice state={access.state} />
}

export const metadata = { title: "Listas de preços" }
