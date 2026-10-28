import Link from "next/link"
import { connection } from "next/server"
import { PageHeader } from "@/components/page-header"
import { currentSession } from "@/lib/erp-session"
import { StockWorkspace } from "./stock-workspace"

export async function StockAccess() {
  await connection()
  const configured = Boolean(process.env.ERP_SESSION_SECRET && Buffer.byteLength(process.env.ERP_SESSION_SECRET) >= 32)
  const session = configured ? await currentSession() : null
  if (!session) return <div className="mx-auto w-full min-w-0 max-w-[1600px] px-4 pb-24 pt-6 sm:px-6">
    <PageHeader eyebrow="Estoque" title="Saldos e movimentos" description="Estoque da empresa ativa." />
    <section className="form-section space-y-3">
      <p role="status">{configured ? "Entre para consultar o estoque da sua empresa." : "O acesso corporativo ainda não está configurado neste ambiente."}</p>
      {configured && <Link className="text-primary underline" href="/entrar">Entrar com Ávila Ops</Link>}
    </section>
  </div>
  return <StockWorkspace />
}
