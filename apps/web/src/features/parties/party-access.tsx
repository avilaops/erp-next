import Link from "next/link"
import { connection } from "next/server"
import { currentSession } from "@/lib/erp-session"
import { PageHeader } from "@/components/page-header"
import { PartyEditor, PartyList } from "./party-workspace"

export async function PartyAccess({ editor = false, id, view = false }: { editor?: boolean; id?: string; view?: boolean }) {
  await connection()
  const configured = Boolean(process.env.ERP_SESSION_SECRET && Buffer.byteLength(process.env.ERP_SESSION_SECRET) >= 32)
  const session = configured ? await currentSession() : null
  return <div className="mx-auto w-full min-w-0 max-w-[1600px] px-4 pb-24 pt-6 sm:px-6">
    {!session ? <>
      <PageHeader eyebrow="Cadastros" title="Clientes e fornecedores" description="Pessoas e empresas com relacionamento comercial." />
      <section className="form-section space-y-3">
        <p role="status">{configured ? "Entre para consultar os clientes e fornecedores da sua empresa." : "O acesso corporativo ainda não está configurado neste ambiente."}</p>
        {configured && <Link className="text-primary underline" href="/entrar">Entrar com Ávila Ops</Link>}
      </section>
    </> : editor ? <PartyEditor key={`${id || "new"}-${view}`} id={id} view={view} /> : <PartyList />}
  </div>
}
