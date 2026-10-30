import { connection } from "next/server"
import Link from "next/link"
import { Suspense } from "react"
import { PageHeader } from "@/components/page-header"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/components/workspace-access"
import { DanfeDownload } from "@/features/fiscal/danfe-download"

async function DanfeWorkspace() {
  await connection()
  const access = await currentWorkspaceAccess()
  return access.session ? <DanfeDownload key={access.session.tenantId} tenantId={access.session.tenantId} /> : <WorkspaceAccessNotice state={access.state} />
}

export default function Page() {
  return <div className="mx-auto w-full min-w-0 max-w-5xl px-4 pb-24 pt-6 sm:px-6">
    <PageHeader eyebrow="Fiscal" title="DANFE a partir de XML autorizado" description="Geração de PDF para documentos da empresa ativa." />
    <Link className="mb-5 inline-block text-primary underline" href="/fiscal/notas-saida">Voltar às notas fiscais</Link>
    <Suspense fallback={<p role="status">Carregando acesso fiscal…</p>}><DanfeWorkspace /></Suspense>
  </div>
}

export const metadata = { title: "DANFE" }
