import { Suspense } from "react"
import { CommercialSettings } from "@/features/commercial-settings/commercial-settings"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"

export const metadata = { title: "Parâmetros comerciais" }

type PageProps = { searchParams: Promise<{ linha?: string }> }

export default function Page(props: PageProps) {
  return <Suspense fallback={<p role="status">Carregando parâmetros…</p>}><CommercialAccess {...props} /></Suspense>
}

async function CommercialAccess({ searchParams }: PageProps) {
  const params = await searchParams
  const line = params.linha === "national" ? "national" : "imported"
  const access = await currentWorkspaceAccess()
  return access.session ? <CommercialSettings key={line} initialLine={line} /> : <WorkspaceAccessNotice state={access.state} />
}
