import { Suspense } from "react"
import { PageHeader } from "@/components/page-header"
import { AccessWorkspace } from "@/features/access/access-workspace"

export default function NewUserPage() {
  return <div className="mx-auto max-w-5xl px-4 pb-28 pt-8 lg:px-6"><PageHeader eyebrow="Preferências / Usuários" title="Convidar usuário" description="Envie um convite e defina o que a pessoa poderá fazer nesta empresa." /><Suspense fallback={<p role="status">Carregando acessos…</p>}><AccessWorkspace view="invite" /></Suspense></div>
}
