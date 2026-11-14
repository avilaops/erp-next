import { ProductCosts } from "@/features/catalog/product-costs"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"

export const metadata = { title: "Custos do produto" }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const access = await currentWorkspaceAccess()
  const { id } = await params
  return access.session ? <ProductCosts id={id} /> : <WorkspaceAccessNotice state={access.state} />
}

