import { Suspense } from "react"
import { notFound } from "next/navigation"
import { AccessWorkspace } from "@/features/access/access-workspace"
import { PageHeader } from "@/components/page-header"
import { uuidPattern } from "@/lib/erp-session"

export default function EditUserPage({ params }: PageProps<"/preferencias/usuarios/[id]">) {
  return <div className="mx-auto max-w-5xl px-4 pb-28 pt-8 lg:px-6"><PageHeader eyebrow="Preferências / Usuários" title="Acesso do usuário" description="Consulte a identidade central e gerencie sua associação a esta empresa." /><Suspense fallback={<p role="status">Carregando acesso…</p>}><ResolvedMember params={params} /></Suspense></div>
}

async function ResolvedMember({ params }: Pick<PageProps<"/preferencias/usuarios/[id]">, "params">) {
  const { id } = await params
  if (!uuidPattern.test(id)) notFound()
  return <AccessWorkspace view="member" memberId={id} />
}

export const metadata = { title: "Detalhes do usuário" }
