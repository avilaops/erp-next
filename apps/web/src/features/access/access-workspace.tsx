import Link from "next/link"
import { connection } from "next/server"
import { currentSession } from "@/lib/erp-session"
import { UsersManager } from "./users-manager"
import { RolesManager } from "./roles-manager"
import { MemberEditor } from "./member-editor"

export async function AccessWorkspace({ view, memberId }: { view: "users" | "roles" | "member"; memberId?: string }) {
  await connection()
  if (!process.env.ERP_SESSION_SECRET || Buffer.byteLength(process.env.ERP_SESSION_SECRET) < 32) return <section className="form-section" role="status">O acesso corporativo ainda não está configurado neste ambiente. Usuários e papéis ficam disponíveis após a configuração.</section>
  if (!await currentSession()) return <section className="form-section space-y-3"><p role="status">Entre para consultar os acessos da sua empresa.</p><Link className="text-primary underline" href="/entrar">Entrar com Ávila Ops</Link></section>
  if (view === "member" && memberId) return <MemberEditor key={memberId} memberId={memberId} />
  return view === "roles" ? <RolesManager /> : <UsersManager />
}
