import { Suspense } from "react"
import { AccessWorkspace } from "@/features/access/access-workspace"

export default function UsersAccessPage() {
  return <div className="mx-auto max-w-5xl px-4 pb-28 pt-8 lg:px-6"><Suspense fallback={<p role="status">Carregando usuários…</p>}><AccessWorkspace view="users" /></Suspense></div>
}

export const metadata = { title: "Usuários e acessos" }
