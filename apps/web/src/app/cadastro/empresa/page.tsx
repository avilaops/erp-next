import { CompanySignup } from "@/components/company-onboarding"
import { PageHeader } from "@/components/page-header"

export default function Page() {
  return <main className="mx-auto max-w-3xl space-y-6 px-4 py-12"><PageHeader eyebrow="Primeiro acesso" title="Cadastrar empresa" description="Preencha os dados para começar a usar o ERP." /><CompanySignup /></main>
}
