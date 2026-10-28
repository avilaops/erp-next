import { CompanyPicker } from "@/components/company-onboarding"
import { PageHeader } from "@/components/page-header"

export default function Page() {
  return <main className="mx-auto max-w-3xl space-y-6 px-4 py-12"><PageHeader eyebrow="Acesso" title="Suas empresas" description="Acesse uma empresa ou cadastre uma nova." /><CompanyPicker /></main>
}
