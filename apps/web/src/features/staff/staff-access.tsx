import Link from "next/link"
import { connection } from "next/server"
import { currentSession } from "@/lib/erp-session"
import { PageHeader } from "@/components/page-header"
import { StaffEditor, StaffList, type StaffKind } from "./staff-workspace"

export async function StaffAccess({ kind, editor = false, id, view = false }: { kind: StaffKind; editor?: boolean; id?: string; view?: boolean }) {
  await connection()
  const configured = Boolean(process.env.ERP_SESSION_SECRET && Buffer.byteLength(process.env.ERP_SESSION_SECRET) >= 32)
  const session = configured ? await currentSession() : null
  return <div className="mx-auto w-full min-w-0 max-w-[1600px] px-4 pb-24 pt-6 sm:px-6">
    {!session ? <><PageHeader eyebrow="Cadastros" title={kind === "funcionarios" ? "Funcionários" : "Vendedores"} description="Equipe da empresa ativa." /><section className="form-section space-y-3"><p role="status">{configured ? "Entre para consultar a equipe da sua empresa." : "O acesso corporativo ainda não está configurado neste ambiente."}</p>{configured && <Link className="text-primary underline" href="/entrar">Entrar com Ávila Ops</Link>}</section></> : editor ? <StaffEditor key={`${kind}-${id || "new"}-${view}`} kind={kind} id={id} view={view} /> : <StaffList key={kind} kind={kind} />}
  </div>
}
