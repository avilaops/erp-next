import { connection } from "next/server"
import { createHmac } from "node:crypto"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"
import { PageHeader } from "@/components/page-header"
import { PartyEditor, PartyList } from "./party-workspace"
import { PartyDraftSessionCleanup } from "./party-draft-session-cleanup"

export async function PartyAccess({ editor = false, id, view = false }: { editor?: boolean; id?: string; view?: boolean }) {
  await connection()
  const access = await currentWorkspaceAccess()
  const draftScope = access.session ? createHmac("sha256", access.session.accessToken).update(`party-draft:${access.session.tenantId}`).digest("hex") : ""
  return <div className="mx-auto w-full min-w-0 max-w-[1600px] px-4 pb-24 pt-6 sm:px-6">
    <PartyDraftSessionCleanup scope={draftScope || undefined} />
    {!access.session ? <>
      <PageHeader eyebrow="Cadastros" title="Clientes e fornecedores" description="Pessoas e empresas com relacionamento comercial." />
      <WorkspaceAccessNotice state={access.state} />
    </> : editor ? <PartyEditor key={`${draftScope}-${id || "new"}-${view}`} id={id} view={view} draftScope={draftScope} tenantId={access.session.tenantId} /> : <PartyList />}
  </div>
}
