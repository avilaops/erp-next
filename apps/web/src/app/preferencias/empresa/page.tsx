import { Suspense } from "react"
import { CompanyWorkspace } from "@/features/company/company-workspace"
import { CompanyPreferences } from "@/features/company/company-preferences"

export default function CompanyPreferencesPage() {
  return <CompanyPreferences summary={<Suspense fallback={<p role="status">Carregando empresa…</p>}><CompanyWorkspace summary /></Suspense>} />
}
