import { connection } from "next/server"
import { createHmac } from "node:crypto"
import { PageHeader } from "@/components/page-header"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/components/workspace-access"
import { CatalogEditor, CatalogList } from "./catalog-workspace"

export async function CatalogAccess({ editor = false, id, view = false }: { editor?: boolean; id?: string; view?: boolean }) {
  await connection()
  const access = await currentWorkspaceAccess()
  if (!access.session) return <div><PageHeader eyebrow="Cadastros" title={editor ? "Cadastro de produto" : "Produtos"} description="Catálogo da empresa ativa." /><WorkspaceAccessNotice state={access.state} /></div>
  const draftScope = createHmac("sha256", access.session.accessToken).update(`product-draft:${access.session.tenantId}`).digest("hex")
  return editor ? <CatalogEditor key={`${draftScope}-${id || "new"}-${view}`} id={id} view={view} draftScope={draftScope} /> : <CatalogList />
}
