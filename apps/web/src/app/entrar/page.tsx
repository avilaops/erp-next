import { PageHeader } from "@/components/page-header"
import { Suspense } from "react"
import { connection } from "next/server"
import { isErpLoginConfigured, WorkspaceAccessNotice } from "@/components/workspace-access"

export default function LoginPage() {
  return <Suspense fallback={<p role="status">Preparando acesso…</p>}><LoginForm /></Suspense>
}

async function LoginForm() {
  await connection()
  const ready = isErpLoginConfigured()
  return <main className="mx-auto max-w-xl space-y-6 px-4 py-12">
    <PageHeader eyebrow="Sua conta Ávila Ops" title="Entrar no ERP" description="Acesse sua empresa e seus cadastros com sua conta Ávila Ops." />
    {ready ? <form action="/api/auth/login" method="get" className="form-section space-y-4">
      <p className="text-sm text-muted-foreground">Entre com sua conta para selecionar uma empresa ou cadastrar a sua.</p>
      <button className="rounded-xl bg-primary px-4 py-3 font-medium text-primary-foreground" type="submit">Entrar com Ávila Ops</button>
    </form> : <WorkspaceAccessNotice state="configuration" />}
  </main>
}
