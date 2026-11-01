import Link from "next/link"
import { AccessLink } from "../../components/feedback/session-recovery"
import { currentIdentitySession, erpConfiguration, type ErpSession } from "@/server/auth/erp-session"

type WorkspaceAccess =
  | { state: "ready"; session: ErpSession }
  | { state: "configuration" | "login" | "company"; session: null }

export function isErpLoginConfigured(): boolean {
  try {
    const config = erpConfiguration()
    return Boolean(config.clientId?.trim() && config.clientSecret?.trim())
  } catch {
    return false
  }
}

export async function currentWorkspaceAccess(): Promise<WorkspaceAccess> {
  try {
    erpConfiguration()
  } catch {
    return { state: "configuration", session: null }
  }
  const identity = await currentIdentitySession()
  if (identity?.tenantId) return { state: "ready", session: { ...identity, tenantId: identity.tenantId } }
  if (identity) return { state: "company", session: null }
  return { state: isErpLoginConfigured() ? "login" : "configuration", session: null }
}

export function WorkspaceAccessNotice({ state }: { state: WorkspaceAccess["state"] }) {
  return <section className="form-section space-y-3">
    <p role="status">{state === "configuration"
      ? "O login do ERP ainda não foi configurado neste ambiente. A configuração é necessária para acessar e salvar os cadastros."
      : state === "company"
        ? "Você já entrou. Selecione uma empresa ou cadastre a sua para continuar."
        : "Entre com sua conta Ávila Ops para acessar os cadastros da sua empresa."}</p>
    {state === "login" && <AccessLink />}
    {state === "company" && <div className="flex flex-wrap gap-4">
      <AccessLink page="/empresas">Selecionar empresa</AccessLink>
      <Link className="font-medium text-primary underline" href="/cadastro/empresa">Cadastrar empresa</Link>
    </div>}
  </section>
}
