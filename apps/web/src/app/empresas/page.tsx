import { Suspense } from "react"
import { redirect } from "next/navigation"
import { CompanyPicker } from "@/components/company-onboarding"
import { PageHeader } from "@/components/page-header"
import { currentIdentitySession } from "@/lib/erp-session"

export default function Page() {
  return <Suspense fallback={<p role="status">Consultando acesso…</p>}><AuthenticatedCompanies /></Suspense>
}

async function AuthenticatedCompanies() {
  if (!await currentIdentitySession()) redirect("/entrar")
  return <main className="mx-auto max-w-3xl space-y-6 px-4 py-12"><PageHeader eyebrow="Acesso" title="Suas empresas" description="Acesse uma empresa ou cadastre uma nova." /><CompanyPicker /></main>
}
