import { Suspense } from "react"
import { connection } from "next/server"
import { redirect } from "next/navigation"
import { CompanySignup } from "@/components/company-onboarding"
import { PageHeader } from "@/components/page-header"
import { currentIdentitySession } from "@/lib/erp-session"

export default function Page() {
  return <Suspense fallback={<p role="status">Preparando cadastro…</p>}><AuthenticatedSignup /></Suspense>
}

async function AuthenticatedSignup() {
  await connection()
  if (!await currentIdentitySession()) redirect("/entrar")
  return <main className="mx-auto max-w-3xl space-y-6 px-4 py-12"><PageHeader eyebrow="Primeiro acesso" title="Cadastrar empresa" description="Preencha os dados para começar a usar o ERP." /><CompanySignup /></main>
}

export const metadata = { title: "Cadastrar empresa" }
