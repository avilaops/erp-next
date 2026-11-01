import { GuardedLink as Link } from "@/components/navigation-guard"
import { ChevronLeft } from "lucide-react"
import { Suspense } from "react"
import { CompanyWorkspace } from "@/features/company/company-workspace"
import { PageHeader } from "@/components/page-header"

export default function CompanyDataPage() {
  return (
    <div className="mx-auto max-w-[1600px] px-4 pb-28 pt-8 lg:px-6">
      <Link className="mb-6 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground" href="/preferencias"><ChevronLeft className="size-4" />Preferências</Link>
      <PageHeader eyebrow="Preferências / Empresa" title="Alterar dados da empresa" description="Escolha uma seção para consultar ou editar. Campos marcados com * são obrigatórios." />
      <Suspense fallback={<p role="status">Carregando empresa…</p>}><CompanyWorkspace /></Suspense>
    </div>
  )
}

export const metadata = { title: "Alterar dados da empresa" }
