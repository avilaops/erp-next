import { Suspense } from "react"
import { connection } from "next/server"
import Link from "next/link"
import { PageHeader } from "@/components/page-header"
import { currentSession } from "@/lib/erp-session"
import { referenceConfigs, type ReferenceKind } from "./reference-config"
import { ReferenceWorkspace } from "./reference-workspace"

type AccessProps = { kind: ReferenceKind; id?: string; params?: Promise<{ id: string }>; mode?: "list" | "view" | "edit" | "create" }

export function ReferenceAccess(props: AccessProps) {
  return <Suspense fallback={<p role="status">Carregando cadastro…</p>}><ResolvedReference {...props} /></Suspense>
}

async function ResolvedReference({ params, ...props }: AccessProps) {
  return <AuthorizedReference {...props} id={params ? (await params).id : props.id} />
}

async function AuthorizedReference({ kind, id, mode = "list" }: { kind: ReferenceKind; id?: string; mode?: "list" | "view" | "edit" | "create" }) {
  await connection()
  const configured = Boolean(process.env.ERP_SESSION_SECRET && Buffer.byteLength(process.env.ERP_SESSION_SECRET) >= 32)
  const session = configured ? await currentSession() : null
  const config = referenceConfigs[kind]
  return <div className="mx-auto w-full min-w-0 max-w-6xl px-4 pb-24 pt-6 sm:px-6">
    {session ? <ReferenceWorkspace key={`${kind}:${id || "new"}:${mode}`} kind={kind} id={id} mode={mode} /> : <>
      <PageHeader eyebrow="Cadastros" title={config.title} description={config.description} />
      <section className="form-section space-y-3"><p role="status">{configured ? "Entre para acessar os cadastros da sua empresa." : "O acesso corporativo ainda não está configurado neste ambiente."}</p>{configured && <Link className="text-primary underline" href="/entrar">Entrar com Ávila Ops</Link>}</section>
    </>}
  </div>
}
