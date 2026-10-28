"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { AccessProblem, errorMessage, read, write, type Access, type Member, type Role, type Snapshot } from "./access-client"

type Loaded = { access: Access; member: Snapshot<Member>; roles: Role[] }
async function load(memberId: string, signal?: AbortSignal): Promise<Loaded> {
  const { data: access } = await read<Access>("me", signal)
  const [member, roles] = await Promise.all([read<Member>(`users/${memberId}`, signal), access.permissions.includes("platform.roles.read") ? read<{ data: Role[] }>("roles", signal) : Promise.resolve({ data: { data: [] } })])
  return { access, member, roles: roles.data.data }
}

export function MemberEditor({ memberId }: { memberId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [problem, setProblem] = useState("")
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    load(memberId, controller.signal).then((result) => { if (!controller.signal.aborted) setLoaded(result) }).catch((error) => { if (!controller.signal.aborted) setProblem(errorMessage(error)) })
    return () => controller.abort()
  }, [memberId])
  if (!loaded) return <section className="form-section"><p role={problem ? "alert" : "status"}>{problem || "Carregando acesso…"}</p>{problem && <Button onClick={() => window.location.reload()}>Tentar novamente</Button>}</section>
  return <>{saved && <p role="status" className="mb-5">Acesso salvo no servidor.</p>}<MemberForm key={`${loaded.member.data.id}-${loaded.member.data.revision}`} loaded={loaded} onEdited={() => setSaved(false)} onReload={async () => { setLoaded(await load(memberId)); setSaved(false) }} onSaved={async () => { setLoaded(await load(memberId)); setSaved(true) }} /></>
}

function MemberForm({ loaded, onReload, onSaved, onEdited }: { loaded: Loaded; onReload: () => Promise<void>; onSaved: () => Promise<void>; onEdited: () => void }) {
  const { access, member, roles } = loaded
  const [status, setStatus] = useState(member.data.status)
  const [roleIds, setRoleIds] = useState(member.data.roleIds)
  const [problem, setProblem] = useState("")
  const [conflict, setConflict] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  const currentRoles = roles.filter((role) => member.data.roleIds.includes(role.id))
  const canEdit = ["platform.users.read", "platform.users.manage", "platform.roles.read"].every((permission) => access.permissions.includes(permission)) && currentRoles.every((role) => role.permissions.every((permission) => access.permissions.includes(permission)))
  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener("beforeunload", preventLoss)
    return () => window.removeEventListener("beforeunload", preventLoss)
  }, [dirty])
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!canEdit || conflict || busy) return
    setBusy(true); setProblem(""); setSaved(false)
    try {
      await write<Member>(`users/${member.data.id}`, "PUT", access.tenant.id, { status, roleIds }, member.etag)
      setDirty(false); setSaved(true)
      try { await onSaved() }
      catch { setProblem("Acesso salvo no servidor. Não foi possível atualizar a consulta; recarregue a página para conferir seus acessos atuais."); setConflict(true) }
    } catch (error) { setProblem(errorMessage(error)); setConflict(error instanceof AccessProblem && [0, 409, 412, 503].includes(error.status)) }
    finally { setBusy(false) }
  }
  return <div className="space-y-5">
    <Link className="text-primary underline" href="/preferencias/usuarios" onClick={(event) => { if (dirty && !window.confirm("Descartar sua edição e voltar à lista?")) event.preventDefault() }}>Voltar aos usuários</Link>
    {!canEdit && <p role="status">Acesso somente de consulta. Você não tem autoridade para alterar esta associação.</p>}
    {saved && <p role="status">Acesso salvo no servidor.</p>}
    {problem && <div className="form-section space-y-3" role="alert"><p>{problem}</p>{conflict && <Button variant="outline" disabled={busy} onClick={async () => { if (!window.confirm("Recarregar e descartar sua edição?")) return; try { await onReload() } catch (error) { setProblem(errorMessage(error)) } }}>Recarregar e descartar edição</Button>}</div>}
    <form onSubmit={save} className="form-section space-y-5" onChange={() => { setDirty(true); setSaved(false); onEdited() }}>
      <p className="text-sm text-muted-foreground">Revisão {member.data.revision} · Empresa {access.tenant.legalName}</p>
      <div className="grid gap-4 sm:grid-cols-2"><label>Nome no Auth<input className="min-h-10 min-w-0 rounded-xl border border-input bg-background px-3 text-sm disabled:opacity-60 mt-2 w-full" value={member.data.name} disabled /></label><label>E-mail no Auth<input className="min-h-10 min-w-0 rounded-xl border border-input bg-background px-3 text-sm disabled:opacity-60 mt-2 w-full" value={member.data.email} disabled /></label></div>
      <fieldset disabled={!canEdit || busy || conflict} className="space-y-5">
        <label className="block">Situação do acesso<select className="min-h-10 min-w-0 rounded-xl border border-input bg-background px-3 text-sm disabled:opacity-60 mt-2 w-full" value={status} onChange={(event) => setStatus(event.target.value)}>{member.data.status === "pending" && <option value="pending">Pendente de confirmação no Auth</option>}{member.data.status !== "pending" && <option value="active">Ativo</option>}{member.data.status !== "pending" && <option value="blocked">Bloqueado</option>}</select></label>
        <fieldset className="space-y-3"><legend className="mb-3 font-semibold">Papéis nesta empresa</legend>{roles.map((role) => <label className="flex items-start gap-3 break-words" key={role.id}><input type="checkbox" className="mt-1" checked={roleIds.includes(role.id)} disabled={!role.permissions.every((permission) => access.permissions.includes(permission))} onChange={(event) => setRoleIds((current) => event.target.checked ? [...current, role.id] : current.filter((id) => id !== role.id))} /><span>{role.name}<small className="block text-muted-foreground">{role.code}</small></span></label>)}{!roles.length && <p>Catálogo de papéis não disponível para seu acesso.</p>}</fieldset>
        <Button type="submit" disabled={!dirty}>{busy ? "Salvando…" : "Salvar acesso"}</Button>
      </fieldset>
    </form>
  </div>
}
