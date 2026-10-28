import Link from "next/link"
import { connection } from "next/server"
import { PageHeader } from "@/components/page-header"
import { currentSession } from "@/lib/erp-session"
import { CatalogEditor, CatalogList } from "./catalog-workspace"

export async function CatalogAccess({ editor = false, id, view = false }: { editor?: boolean; id?: string; view?: boolean }) {
  await connection()
  const configured = Boolean(process.env.ERP_SESSION_SECRET && Buffer.byteLength(process.env.ERP_SESSION_SECRET) >= 32)
  const session = configured ? await currentSession() : null
  if (!session) return <div><PageHeader eyebrow="Cadastros" title={editor ? "Cadastro de produto" : "Produtos"} description="Catálogo da empresa ativa." /><section className="form-section space-y-3"><p role="status">{configured ? "Entre para consultar os produtos da sua empresa." : "O acesso corporativo ainda não está configurado neste ambiente. O catálogo fica disponível após a configuração."}</p>{configured && <Link className="text-primary underline" href="/entrar">Entrar com Ávila Ops</Link>}</section></div>
  return editor ? <CatalogEditor key={`${id || "new"}-${view}`} id={id} view={view} /> : <CatalogList />
}
