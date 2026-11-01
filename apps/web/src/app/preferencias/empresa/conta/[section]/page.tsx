import { Suspense } from "react"
import { notFound } from "next/navigation"
import { connection } from "next/server"
import { AccountShell } from "@/features/company/account/account-shell"
import { AccountClient } from "@/features/company/account/account-client"
import { accountSections, type AccountSection } from "@/features/company/account/account-navigation"
import { CompanyWorkspace } from "@/features/company/company-workspace"
import { Empty, Notice } from "@/features/company/account/account-panels"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"
import Link from "next/link"

export function generateStaticParams() { return Object.keys(accountSections).map(section => ({ section })) }
export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params
  return { title: Object.hasOwn(accountSections, section) ? accountSections[section as AccountSection] : "Conta da empresa" }
}
async function AccountWorkspace({ section }: { section: AccountSection }) {
  await connection()
  const access = await currentWorkspaceAccess()
  if (!access.session) return <WorkspaceAccessNotice state={access.state} />
  return <AccountClient section={section} />
}
export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params
  if (!Object.hasOwn(accountSections, section)) notFound()
  return <AccountShell><Suspense fallback={<p role="status">Carregando conta da empresa…</p>}>
    {section === "socio" ? <CompanyWorkspace partner /> : section === "horarios" ? <section className="form-section space-y-5"><h2 className="text-xl font-semibold">Controle de horários</h2><Empty title="Restrição de acesso por horário indisponível" text="Os papéis atuais controlam permissões, mas ainda não aplicam uma janela de horário para entrar no ERP." /><Notice>Você pode administrar os acessos existentes em <Link href="/preferencias/papeis" className="font-medium text-primary underline">Papéis e permissões</Link>.</Notice></section> : <AccountWorkspace section={section as AccountSection} />}
  </Suspense></AccountShell>
}
