import { Suspense } from "react"
import { connection } from "next/server"
import { PageHeader } from "@/components/page-header"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"
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
  const access = await currentWorkspaceAccess()
  const config = referenceConfigs[kind]
  return <div className="mx-auto w-full min-w-0 max-w-6xl px-4 pb-24 pt-6 sm:px-6">
    {access.session ? <ReferenceWorkspace key={`${kind}:${id || "new"}:${mode}`} kind={kind} id={id} mode={mode} /> : <>
      <PageHeader eyebrow="Cadastros" title={config.title} description={config.description} />
      <WorkspaceAccessNotice state={access.state} />
    </>}
  </div>
}
