"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { read, errorMessage, statusLabel, type Access, type User } from "./access-client"

export function UsersManager() {
  const [users, setUsers] = useState<User[] | null>(null)
  const [problem, setProblem] = useState("")
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    read<Access>("me", controller.signal).then(() => read<{ data: User[] }>("users", controller.signal))
      .then(({ data }) => { if (!controller.signal.aborted) setUsers(data.data) })
      .catch((error) => { if (!controller.signal.aborted) setProblem(errorMessage(error)) })
    return () => controller.abort()
  }, [])
  if (!users) return <section className="form-section"><p role={problem ? "alert" : "status"}>{problem || "Carregando usuários…"}</p>{problem && <Button onClick={() => window.location.reload()}>Tentar novamente</Button>}</section>
  const normalized = query.trim().toLocaleLowerCase("pt-BR")
  const visible = users.filter((user) => (!status || status === user.status) && `${user.name} ${user.email} ${user.roles.join(" ")}`.toLocaleLowerCase("pt-BR").includes(normalized))
  return <div className="space-y-5">
    <div className="form-section flex flex-wrap gap-4">
      <label className="min-w-0 flex-1">Buscar usuário<input className="min-h-10 min-w-0 rounded-xl border border-input bg-background px-3 text-sm disabled:opacity-60 mt-2 w-full" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, e-mail ou papel" /></label>
      <label>Situação<select className="min-h-10 min-w-0 rounded-xl border border-input bg-background px-3 text-sm disabled:opacity-60 mt-2 w-full" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todas</option><option value="active">Ativo</option><option value="blocked">Bloqueado</option><option value="pending">Pendente</option></select></label>
    </div>
    <p className="text-sm text-muted-foreground">{visible.length} de {users.length} associações nesta empresa. Nome e e-mail pertencem ao cadastro central de identidade.</p>
    <ul className="space-y-3">{visible.map((user) => <li className="form-section flex flex-wrap items-center justify-between gap-4" key={user.id}><div className="min-w-0 break-words"><h2 className="font-semibold">{user.name}</h2><p className="text-sm">{user.email}</p><p className="mt-2 text-sm text-muted-foreground">{statusLabel(user.status)} · {user.roles.join(", ") || "Sem papel atribuído"}</p></div><Link className="text-primary underline" href={`/preferencias/usuarios/${user.id}`}>Consultar acesso de {user.name}</Link></li>)}</ul>
    {!visible.length && <p role="status">Nenhum usuário corresponde aos filtros.</p>}
    <section className="form-section space-y-3"><h2 className="font-semibold">Novos usuários</h2><p className="text-sm text-muted-foreground">Convites dependem da integração de provisionamento com o Auth. O ERP ainda não cria identidades nem envia e-mails.</p><Button disabled>Convidar usuário indisponível</Button></section>
  </div>
}
