import { connection } from "next/server"
import { PageHeader } from "@/components/page-header"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/components/workspace-access"
import { CatalogEditor, CatalogList } from "./catalog-workspace"

export async function CatalogAccess({ editor = false, id, view = false }: { editor?: boolean; id?: string; view?: boolean }) {
  await connection()
  const access = await currentWorkspaceAccess()
  if (!access.session) return <div><PageHeader eyebrow="Cadastros" title={editor ? "Cadastro de produto" : "Produtos"} description="Catálogo da empresa ativa." /><WorkspaceAccessNotice state={access.state} /></div>
  return editor ? <CatalogEditor key={`${id || "new"}-${view}`} id={id} view={view} /> : <CatalogList />
}
