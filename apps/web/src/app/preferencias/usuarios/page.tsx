import { Suspense } from "react"
import { AccessWorkspace } from "@/features/access/access-workspace"
import { PageHeader } from "@/components/page-header"

export default function UsersAccessPage() {
  return <div className="mx-auto max-w-5xl px-4 pb-28 pt-8 lg:px-6"><PageHeader eyebrow="Preferências / Acessos" title="Usuários" description="Associações, situação e papéis dos usuários nesta empresa." /><Suspense fallback={<p role="status">Carregando usuários…</p>}><AccessWorkspace view="users" /></Suspense></div>
}

export const metadata = { title: "Usuários e acessos" }
