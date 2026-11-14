import { PriceTables } from "@/features/commercial-settings/price-tables"
import { Suspense } from "react"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"

export const metadata = { title: "Tabela de preços" }

type PageProps = { searchParams: Promise<{ linha?: string }> }

export default function Page(props: PageProps) {
  return <Suspense fallback={<p role="status">Carregando tabela de preços…</p>}><PriceTablesAccess {...props} /></Suspense>
}

async function PriceTablesAccess({ searchParams }: PageProps) {
  const params = await searchParams
  const initialLine = params.linha === "national" ? "national" : "imported"
  const access = await currentWorkspaceAccess()
  return access.session ? <PriceTables key={initialLine} initialLine={initialLine} /> : <WorkspaceAccessNotice state={access.state} />
}

