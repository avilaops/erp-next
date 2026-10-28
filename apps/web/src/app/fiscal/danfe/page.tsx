import { connection } from "next/server"
import Link from "next/link"
import { Suspense } from "react"
import { PageHeader } from "@/components/page-header"
import { currentSession } from "@/lib/erp-session"
import { DanfeDownload } from "@/features/fiscal/danfe-download"

async function DanfeWorkspace() {
  await connection()
  const configured = Boolean(process.env.ERP_SESSION_SECRET && Buffer.byteLength(process.env.ERP_SESSION_SECRET) >= 32)
  const session = configured ? await currentSession() : null
  return session ? <DanfeDownload key={session.tenantId} tenantId={session.tenantId} /> : <section className="form-section space-y-3"><p role="status">{configured ? "Entre para gerar o DANFE da sua empresa." : "O acesso corporativo ainda não está configurado neste ambiente."}</p>{configured && <Link className="text-primary underline" href="/entrar">Entrar com Ávila Ops</Link>}</section>
}

export default function Page() {
  return <div className="mx-auto w-full min-w-0 max-w-5xl px-4 pb-24 pt-6 sm:px-6">
    <PageHeader eyebrow="Fiscal" title="DANFE a partir de XML autorizado" description="Geração de PDF para documentos da empresa ativa." />
    <Link className="mb-5 inline-block text-primary underline" href="/fiscal/notas-saida">Voltar às notas fiscais</Link>
    <Suspense fallback={<p role="status">Carregando acesso fiscal…</p>}><DanfeWorkspace /></Suspense>
  </div>
}
