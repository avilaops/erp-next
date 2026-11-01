import { PreferencesOverview } from "@/features/preferences-search/preferences-overview"
import { Suspense } from "react"

export const metadata = { title: "Preferências" }

export default function PreferencesPage() {
  return <Suspense fallback={<p role="status" className="p-6">Carregando preferências…</p>}><PreferencesOverview /></Suspense>
}
