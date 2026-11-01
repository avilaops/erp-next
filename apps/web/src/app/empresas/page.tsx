import { Suspense } from "react"
import { connection } from "next/server"
import { redirect } from "next/navigation"
import { CompanyPicker } from "@/features/company/company-onboarding"
import { PageHeader } from "@/components/page-header"
import { currentIdentitySession } from "@/server/auth/erp-session"

export default function Page() {
  return <Suspense fallback={<p role="status">Consultando acesso…</p>}><AuthenticatedCompanies /></Suspense>
}

async function AuthenticatedCompanies() {
  await connection()
  if (!await currentIdentitySession()) redirect("/entrar")
  return <main className="mx-auto max-w-3xl space-y-6 px-4 py-12"><PageHeader eyebrow="Acesso" title="Suas empresas" description="Acesse uma empresa ou cadastre uma nova." /><CompanyPicker /></main>
}

export const metadata = { title: "Suas empresas" }
