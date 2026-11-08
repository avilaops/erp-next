import { Suspense } from "react"
import { AccessWorkspace } from "@/features/access/access-workspace"

export default function RolesPage() {
  return <div className="mx-auto max-w-5xl px-4 pb-28 pt-8 lg:px-6"><Suspense fallback={<p role="status">Carregando papéis…</p>}><AccessWorkspace view="roles" /></Suspense></div>
}

export const metadata = { title: "Papéis e permissões" }
