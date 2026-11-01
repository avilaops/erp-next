import { Suspense } from "react"
import Link from "next/link"
import { connection } from "next/server"
import { PageHeader } from "@/components/page-header"
import { currentSession } from "@/server/auth/erp-session"
import { ServiceKeys } from "@/features/integrations/service-keys"

export default function LojasIntegrationPage() {
  return <Suspense fallback={<p role="status">Carregando integração…</p>}><LojasAccess /></Suspense>
}

async function LojasAccess() {
  await connection()
  const configured = Boolean(process.env.ERP_SESSION_SECRET && Buffer.byteLength(process.env.ERP_SESSION_SECRET) >= 32)
  const session = configured ? await currentSession() : null
  return <div className="mx-auto w-full min-w-0 max-w-5xl px-4 pb-24 pt-8 lg:px-6">
    <PageHeader eyebrow="Preferências / Integrações" title="Integração com Lojas" description="Gerencie as chaves de serviço da empresa ativa. Criar uma chave não configura automaticamente o Lojas." />
    {session ? <ServiceKeys key={session.tenantId} tenantId={session.tenantId} /> : <p role="status">Entre para gerenciar integrações. <Link href="/entrar" className="text-primary underline">Entrar com Ávila Ops</Link></p>}
  </div>
}

export const metadata = { title: "Integração com lojas" }
