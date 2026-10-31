import { Suspense } from "react"
import { CompanyWorkspace } from "@/features/company/company-workspace"
import { CompanyPreferences } from "@/features/company/company-preferences"
import { CompanyProfileProvider } from "@/features/company/company-profile-context"

export default function CompanyPreferencesPage() {
  return <CompanyProfileProvider><CompanyPreferences summary={<Suspense fallback={<p role="status">Carregando empresa…</p>}><CompanyWorkspace summary /></Suspense>} /></CompanyProfileProvider>
}

export const metadata = { title: "Empresa" }
