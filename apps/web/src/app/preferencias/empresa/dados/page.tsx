import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { CompanyDataForm } from "@/features/company/company-data-form"
import { PageHeader } from "@/components/page-header"

export default function CompanyDataPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-28 pt-8 lg:px-6">
      <Link className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" href="/preferencias/empresa"><ChevronLeft className="size-4" />Empresa</Link>
      <PageHeader eyebrow="Preferências / Empresa" title="Dados da empresa" description="Informações usadas em documentos, integrações e operações. Campos marcados com * são obrigatórios." />
      <CompanyDataForm />
    </div>
  )
}
