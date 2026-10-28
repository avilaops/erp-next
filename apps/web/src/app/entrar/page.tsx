import { PageHeader } from "@/components/page-header"
import { Suspense } from "react"
import { connection } from "next/server"

export default function LoginPage() {
  return <Suspense fallback={<p role="status">Preparando acesso…</p>}><LoginForm /></Suspense>
}

async function LoginForm() {
  await connection()
  const ready = Boolean(process.env.ERP_AUTH_CLIENT_ID && process.env.ERP_AUTH_CLIENT_SECRET && process.env.ERP_SESSION_SECRET)
  return <main className="mx-auto max-w-xl space-y-6 px-4 py-12">
    <PageHeader eyebrow="Acesso corporativo" title="Entrar no ERP" description="Use sua conta Ávila Ops para acessar uma empresa à qual você está associado." />
    {ready ? <form action="/api/auth/login" method="get" className="form-section space-y-4">
      <p className="text-sm text-muted-foreground">Entre com sua conta para selecionar uma empresa ou cadastrar a sua.</p>
      <button className="rounded-xl bg-primary px-4 py-3 font-medium text-primary-foreground" type="submit">Entrar com Ávila Ops</button>
    </form> : <p role="status" className="form-section">O acesso corporativo ainda não está configurado neste ambiente. Solicite a configuração ao administrador.</p>}
  </main>
}
