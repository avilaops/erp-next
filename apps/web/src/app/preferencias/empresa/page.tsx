import { connection } from "next/server"
import { Suspense } from "react"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"
import { PageHeader } from "@/components/page-header"
import { CompanySummary } from "@/features/company/company-summary"
import { CompanyPreferences } from "@/features/company/company-preferences"
import { CompanyProfileProvider } from "@/features/company/company-profile-context"

export default function CompanyPreferencesPage() {
  return <Suspense fallback={<p className="px-4 py-8" role="status">Carregando preferências da empresa…</p>}><CompanyPreferencesContent /></Suspense>
}

async function CompanyPreferencesContent() {
  await connection()
  const access = await currentWorkspaceAccess()
  if (!access.session) return <div className="mx-auto max-w-6xl space-y-5 px-4 py-8"><PageHeader eyebrow="Preferências" title="Empresa" description="Consulte os dados da empresa ativa." /><WorkspaceAccessNotice state={access.state} /></div>
  // Keep the summary in the same hydration tree as its client context. An
  // asynchronous server slot could arrive after the profile request updated it.
  return <CompanyProfileProvider><CompanyPreferences summary={<CompanySummary />} /></CompanyProfileProvider>
}

export const metadata = { title: "Empresa" }
