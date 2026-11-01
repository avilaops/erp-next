"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { read, write, errorMessage, invitationDelivery, type Access, type Invitation, type Invitations, type Role } from "./access-client"

const managerPermissions = ["platform.company.read", "platform.users.read", "platform.users.manage", "platform.roles.read"]
const field = "mt-2 min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm disabled:opacity-60"

export function InvitationEditor() {
  const [context, setContext] = useState<{ access: Access; roles: Role[]; enabled: boolean } | null>(null)
  const [problem, setProblem] = useState("")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [roleIds, setRoleIds] = useState<string[]>([])
  const [manageUsers, setManageUsers] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Invitation | null>(null)
  const command = useRef<{ body: string; key: string } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    read<Access>("me", controller.signal).then(async ({ data: access }) => {
      if (!["platform.users.read", "platform.users.manage", "platform.roles.read"].every((p) => access.permissions.includes(p))) throw new Error("Você precisa de permissão para gerenciar usuários e consultar papéis nesta empresa.")
      const [roles, invitations] = await Promise.all([read<{ data: Role[] }>("roles", controller.signal), read<Invitations>("invitations", controller.signal)])
      if (!controller.signal.aborted) setContext({ access, roles: roles.data.data, enabled: invitations.data.enabled })
    }).catch((error) => { if (!controller.signal.aborted) setProblem(errorMessage(error)) })
    return () => controller.abort()
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!context || busy || result) return
    const body = { name: name.trim(), email: email.trim().toLowerCase(), roleIds: [...roleIds].sort(), manageUsers }
    const serialized = JSON.stringify(body)
    if (command.current?.body !== serialized) command.current = { body: serialized, key: crypto.randomUUID() }
    setBusy(true); setProblem("")
    try { const response = await write<Invitation>("invitations", "POST", context.access.tenant.id, body, undefined, command.current.key); setResult(response.data) }
    catch (error) { setProblem(errorMessage(error)) }
    finally { setBusy(false) }
  }

  if (!context) return <section className="form-section space-y-4"><p role={problem ? "alert" : "status"}>{problem || "Carregando papéis e permissões…"}</p><Link className="text-primary underline" href="/preferencias/usuarios">Voltar aos usuários</Link></section>
  const canManage = managerPermissions.every((p) => context.access.permissions.includes(p))
  const roles = context.roles.filter((role) => role.permissions.length && role.permissions.every((p) => context.access.permissions.includes(p)))
  if (result) return <section className="form-section space-y-4" aria-label="Resultado do convite">
    <h2 className="text-lg font-semibold">Convite registrado para {result.name}</h2>
    <p>{result.email}</p><p role="status">{invitationDelivery(result.delivery)}</p>
    <p className="text-sm text-muted-foreground">Acesso à empresa {context.access.tenant.legalName}: {result.roles.join(", ")}. O vínculo será ativado quando a pessoa entrar no ERP com este e-mail confirmado no Auth.</p>
    <p className="text-sm">Se já possui conta, usará a senha atual. Se é uma conta nova, receberá as instruções para definir a senha. O convite é válido por sete dias.</p>
    <Link className="text-primary underline" href="/preferencias/usuarios">Ver usuários e acompanhar o convite</Link>
  </section>
  return <form onSubmit={submit} className="space-y-5">
    <section className="form-section space-y-4" aria-labelledby="invite-person">
      <div><h2 id="invite-person" className="font-semibold">Quem vai acessar</h2><p className="mt-1 text-sm text-muted-foreground">Empresa: {context.access.tenant.legalName}</p></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>Nome<input className={field} required autoComplete="name" maxLength={120} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} /></label>
        <label>E-mail<input className={field} required type="email" autoComplete="email" maxLength={254} value={email} disabled={busy} onChange={(e) => setEmail(e.target.value)} aria-describedby="invite-email-help" /></label>
      </div>
      <p id="invite-email-help" className="text-sm text-muted-foreground">A pessoa deverá entrar com esse mesmo e-mail. Não é necessário cadastrar uma senha para ela.</p>
    </section>
    <fieldset className="form-section space-y-4" disabled={busy}>
      <legend className="font-semibold">Acessos nesta empresa</legend>
      <label className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
        <input type="checkbox" className="mt-1 size-4 shrink-0" checked={manageUsers} disabled={!canManage} onChange={(e) => setManageUsers(e.target.checked)} />
        <span><span className="block font-semibold">Pode convidar e gerenciar usuários</span><span className="mt-1 block text-sm text-muted-foreground">Permite convidar pessoas, atribuir os acessos que também possui e bloquear usuários da empresa. Outros módulos dependem dos papéis selecionados abaixo.</span>{!canManage && <span className="mt-1 block text-sm">Seu acesso atual não permite delegar esse conjunto de permissões.</span>}</span>
      </label>
      <p className="text-sm text-muted-foreground">Selecione também os papéis necessários para o trabalho dessa pessoa. Você só pode conceder permissões que possui.</p>
      <div className="grid gap-3 sm:grid-cols-2">{roles.map((role) => <label key={role.id} className="flex items-start gap-3 rounded-xl border p-4">
        <input className="mt-1 size-4 shrink-0" type="checkbox" checked={roleIds.includes(role.id)} onChange={(e) => setRoleIds((ids) => e.target.checked ? [...ids, role.id] : ids.filter((id) => id !== role.id))} />
        <span className="min-w-0"><span className="block font-medium">{role.name}</span><span className="block text-sm text-muted-foreground">{`${role.permissions.length} permissões`}{role.permissions.includes("platform.users.manage") ? " · Inclui gerenciamento de usuários" : ""}</span></span>
      </label>)}</div>
      {!roles.length && <p>Nenhum papel adicional disponível para delegação.</p>}
    </fieldset>
    {!context.enabled && <p role="alert">O serviço de convites precisa ser configurado antes do primeiro envio.</p>}
    {problem && <p role="alert" className="text-destructive">{problem} Seus dados foram preservados. Você pode conferir a lista de convites antes de tentar novamente.</p>}
    <div className="flex flex-wrap items-center gap-4"><Button type="submit" disabled={busy || !context.enabled || (!manageUsers && !roleIds.length)}>{busy ? "Enviando convite…" : "Enviar convite"}</Button><Link className="text-primary underline" href="/preferencias/usuarios">Voltar aos usuários</Link></div>
  </form>
}
