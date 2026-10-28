"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { read, write, errorMessage, statusLabel, invitationStatus, invitationDelivery, type Access, type User, type Invitation, type Invitations } from "./access-client"

export function UsersManager() {
  const [users, setUsers] = useState<User[] | null>(null)
  const [access, setAccess] = useState<Access | null>(null)
  const [invitations, setInvitations] = useState<Invitations | null>(null)
  const [invitationProblem, setInvitationProblem] = useState("")
  const [busy, setBusy] = useState("")
  const [notice, setNotice] = useState("")
  const [cancelId, setCancelId] = useState("")
  const [problem, setProblem] = useState("")
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    read<Access>("me", controller.signal).then(({ data }) => {
      if (!controller.signal.aborted) setAccess(data)
      read<Invitations>("invitations", controller.signal).then(({ data }) => { if (!controller.signal.aborted) setInvitations(data) })
        .catch((error) => { if (!controller.signal.aborted) setInvitationProblem(errorMessage(error)) })
      return read<{ data: User[] }>("users", controller.signal)
    })
      .then(({ data }) => { if (!controller.signal.aborted) setUsers(data.data) })
      .catch((error) => { if (!controller.signal.aborted) setProblem(errorMessage(error)) })
    return () => controller.abort()
  }, [])
  async function act(invitation: Invitation, action: "resend" | "revoke") {
    if (!access || busy) return
    setBusy(invitation.id); setInvitationProblem(""); setNotice("")
    try {
      const { data } = await write<Invitation>(`invitations/${invitation.id}/${action}`, "POST", access.tenant.id, {}, undefined, crypto.randomUUID())
      setInvitations((current) => current && { ...current, data: current.data.map((item) => item.id === data.id ? data : item) })
      setNotice(action === "revoke" ? `Convite de ${data.email} cancelado.` : invitationDelivery(data.delivery))
      setCancelId("")
    } catch (error) { setInvitationProblem(errorMessage(error)) }
    finally { setBusy("") }
  }
  if (!users) return <section className="form-section"><p role={problem ? "alert" : "status"}>{problem || "Carregando usuários…"}</p>{problem && <Button onClick={() => window.location.reload()}>Tentar novamente</Button>}</section>
  const normalized = query.trim().toLocaleLowerCase("pt-BR")
  const visible = users.filter((user) => (!status || status === user.status) && `${user.name} ${user.email} ${user.roles.join(" ")}`.toLocaleLowerCase("pt-BR").includes(normalized))
  const canInvite = !!access && ["platform.users.manage", "platform.roles.read"].every((p) => access.permissions.includes(p))
  const visibleInvitations = invitations?.data.filter((item) => (!status || (status === "pending" && ["pending", "expired"].includes(item.status))) && `${item.name} ${item.email} ${item.roles.join(" ")}`.toLocaleLowerCase("pt-BR").includes(normalized)) || []
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Controle quem pode acessar {access?.tenant.legalName}.</p>{canInvite && <Link className="inline-flex min-h-11 items-center rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground" href="/preferencias/usuarios/novo">Convidar usuário</Link>}</div>
    <div className="form-section flex flex-wrap gap-4">
      <label className="min-w-0 flex-1">Buscar usuário<input className="min-h-10 min-w-0 rounded-xl border border-input bg-background px-3 text-sm disabled:opacity-60 mt-2 w-full" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, e-mail ou papel" /></label>
      <label>Situação<select className="min-h-10 min-w-0 rounded-xl border border-input bg-background px-3 text-sm disabled:opacity-60 mt-2 w-full" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todas</option><option value="active">Ativo</option><option value="blocked">Bloqueado</option><option value="pending">Pendente</option></select></label>
    </div>
    <p className="text-sm text-muted-foreground">{visible.length} de {users.length} associações nesta empresa. Nome e e-mail pertencem ao cadastro central de identidade.</p>
    <ul className="space-y-3">{visible.map((user) => <li className="form-section flex flex-wrap items-center justify-between gap-4" key={user.id}><div className="min-w-0 break-words"><h2 className="font-semibold">{user.name}</h2><p className="text-sm">{user.email}</p><p className="mt-2 text-sm text-muted-foreground">{statusLabel(user.status)} · {user.roles.join(", ") || "Sem papel atribuído"}</p></div><Link className="text-primary underline" href={`/preferencias/usuarios/${user.id}`}>Consultar acesso de {user.name}</Link></li>)}</ul>
    {!visible.length && <p role="status">Nenhum usuário corresponde aos filtros.</p>}
    <section className="space-y-3" aria-labelledby="invitations-heading">
      <h2 id="invitations-heading" className="text-lg font-semibold">Convites</h2>
      <p className="text-sm text-muted-foreground">O convidado recebe as instruções por e-mail e entra com a própria conta. O acesso fica restrito a esta empresa e aos papéis concedidos.</p>
      {notice && <p role="status">{notice}</p>}
      {invitationProblem && <p role="alert" className="text-destructive">{invitationProblem}</p>}
      {!invitations && !invitationProblem && <p role="status">Carregando convites…</p>}
      {invitations && !visibleInvitations.length && <p className="form-section" role="status">Nenhum convite corresponde aos filtros.</p>}
      <ul className="space-y-3">{visibleInvitations.map((item) => <li key={item.id} className="form-section space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 break-words"><h3 className="font-semibold">{item.name}</h3><p className="text-sm">{item.email}</p></div><span className="rounded-full border px-3 py-1 text-sm">{invitationStatus(item.status)}</span></div>
        <p className="text-sm text-muted-foreground">{item.roles.join(", ") || "Papéis removidos"}</p>
        {item.status === "pending" && <><p className="text-sm">{invitationDelivery(item.delivery)}</p><p className="text-sm text-muted-foreground">Válido até {new Date(item.expiresAt).toLocaleString("pt-BR")}</p></>}
        {canInvite && ["pending", "expired"].includes(item.status) && <div className="flex flex-wrap items-center gap-3">
          {item.status === "pending" && <Button variant="outline" disabled={!!busy || !invitations?.enabled} onClick={() => act(item, "resend")}>{busy === item.id ? "Processando…" : "Reenviar convite"}</Button>}
          {cancelId === item.id ? <><span className="text-sm">Cancelar o acesso pendente de {item.name}?</span><Button variant="destructive" disabled={!!busy} onClick={() => act(item, "revoke")}>Confirmar cancelamento</Button><Button variant="ghost" disabled={!!busy} onClick={() => setCancelId("")}>Manter convite</Button></> : <Button variant="ghost" disabled={!!busy} onClick={() => setCancelId(item.id)}>Cancelar convite</Button>}
        </div>}
      </li>)}</ul>
    </section>
  </div>
}
