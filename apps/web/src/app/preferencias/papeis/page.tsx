import { Suspense } from "react"
import { AccessWorkspace } from "@/features/access/access-workspace"
import { PageHeader } from "@/components/page-header"

export default function RolesPage() {
  return <div className="mx-auto max-w-5xl px-4 pb-28 pt-8 lg:px-6"><PageHeader eyebrow="Preferências / Acessos" title="Papéis e permissões" description="Direitos locais do ERP, sujeitos à autoridade de quem está operando." /><Suspense fallback={<p role="status">Carregando papéis…</p>}><AccessWorkspace view="roles" /></Suspense></div>
}

export const metadata = { title: "Papéis e horários" }
