import { GuardedLink as Link } from "@/components/navigation-guard"
import { ChevronLeft } from "lucide-react"
import { Suspense } from "react"
import { CompanyWorkspace } from "@/features/company/company-workspace"
import { PageHeader } from "@/components/page-header"

export default function CompanyDataPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-28 pt-8 lg:px-6">
      <Link className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" href="/preferencias/empresa"><ChevronLeft className="size-4" />Empresa</Link>
      <PageHeader eyebrow="Preferências / Empresa" title="Dados da empresa" description="Informações usadas em documentos, integrações e operações. Campos marcados com * são obrigatórios." />
      <Suspense fallback={<p role="status">Carregando empresa…</p>}><CompanyWorkspace /></Suspense>
    </div>
  )
}

export const metadata = { title: "Dados da empresa" }
