import { Suspense } from "react"
import { notFound } from "next/navigation"
import { UserForm } from "@/features/usuarios/user-form"
import { Skeleton } from "@/components/ui/skeleton"

const mockUserIds = ["1", "2", "3", "4", "5"]

export function generateStaticParams() {
  return mockUserIds.map((id) => ({ id }))
}

export default function EditUserPage({ params }: PageProps<"/preferencias/usuarios/[id]">) {
  return <Suspense fallback={<UserFormLoading />}><ResolvedEditUser params={params} /></Suspense>
}

async function ResolvedEditUser({ params }: Pick<PageProps<"/preferencias/usuarios/[id]">, "params">) {
  const { id } = await params
  if (!mockUserIds.includes(id)) notFound()
  return <UserForm userId={id} />
}

function UserFormLoading() {
  return <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 lg:px-6" aria-label="Carregando usuário"><Skeleton className="h-8 w-44" /><Skeleton className="h-28 w-full rounded-2xl" /><Skeleton className="h-72 w-full rounded-2xl" /><Skeleton className="h-48 w-full rounded-2xl" /></div>
}
