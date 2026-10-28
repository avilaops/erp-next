import Link from "next/link"
import { connection } from "next/server"
import { currentSession } from "@/lib/erp-session"
import { CompanyEditor } from "./company-editor"
import { CompanySummary } from "./company-summary"

export async function CompanyWorkspace({ summary = false }: { summary?: boolean }) {
  await connection()
  const configured = Boolean(process.env.ERP_SESSION_SECRET && Buffer.byteLength(process.env.ERP_SESSION_SECRET) >= 32)
  if (!configured) return <section className="form-section" role="status">O acesso corporativo ainda não está configurado neste ambiente. Os dados da empresa ficam disponíveis após a configuração.</section>
  const session = await currentSession()
  if (!session) return <section className="form-section space-y-3">
    <p role="status">Entre para acessar os dados da sua empresa.</p>
    <Link className="font-medium text-primary underline" href="/entrar">Entrar com Ávila Ops</Link>
  </section>
  return summary ? <CompanySummary /> : <CompanyEditor />
}
