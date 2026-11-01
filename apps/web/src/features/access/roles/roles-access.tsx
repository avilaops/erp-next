"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, Copy, Plus, Save, ShieldCheck, Trash2, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { defaultPermissions, PermissionMatrix } from "@/features/access/users/permission-matrix"

type Role = { id: number; name: string; description: string; members: number; system: boolean; permissions: string[]; days: string[]; start: string; end: string }
const initialRoles: Role[] = [
  { id: 1, name: "Administrador", description: "Acesso completo à empresa.", members: 1, system: true, permissions: ["records.view", "records.manage", "sales.view", "sales.manage", "finance.view", "finance.manage", "preferences.view", "preferences.manage"], days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], start: "00:00", end: "23:59" },
  { id: 2, name: "Gestor", description: "Gestão operacional sem credenciais sensíveis.", members: 1, system: false, permissions: [...defaultPermissions, "records.manage", "sales.manage"], days: ["mon", "tue", "wed", "thu", "fri"], start: "08:00", end: "18:00" },
  { id: 3, name: "Financeiro", description: "Rotinas financeiras e fiscais.", members: 1, system: false, permissions: ["finance.view", "finance.manage", "tax.view"], days: ["mon", "tue", "wed", "thu", "fri"], start: "08:00", end: "18:00" },
  { id: 4, name: "Operação", description: "Cadastros, vendas e serviços.", members: 1, system: false, permissions: ["records.view", "sales.view", "services.view"], days: ["mon", "tue", "wed", "thu", "fri", "sat"], start: "07:00", end: "19:00" },
  { id: 5, name: "Consulta", description: "Acesso somente para visualização.", members: 1, system: false, permissions: defaultPermissions, days: ["mon", "tue", "wed", "thu", "fri"], start: "08:00", end: "18:00" },
]
const days = [["mon", "Seg"], ["tue", "Ter"], ["wed", "Qua"], ["thu", "Qui"], ["fri", "Sex"], ["sat", "Sáb"], ["sun", "Dom"]]

export function RolesAccess() {
  const [roles, setRoles] = useState(initialRoles)
  const [selectedId, setSelectedId] = useState(1)
  const selected = roles.find((role) => role.id === selectedId) ?? roles[0]
  const [draft, setDraft] = useState<Role>(selected)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  function selectRole(role: Role) { setSelectedId(role.id); setDraft(structuredClone(role)); setMessage(""); setError("") }
  function update(patch: Partial<Role>) { setDraft((current) => ({ ...current, ...patch })); setMessage("") }
  function save() {
    if (!draft.name.trim()) return setError("Informe o nome do papel.")
    if (!draft.days.length) return setError("Selecione pelo menos um dia.")
    if (draft.start >= draft.end) return setError("O horário final deve ser posterior ao inicial.")
    setRoles((current) => current.map((role) => role.id === draft.id ? draft : role)); setError(""); setMessage("Papel salvo localmente.")
  }
  function duplicate() {
    const copy = { ...structuredClone(draft), id: Date.now(), name: `${draft.name} — cópia`, members: 0, system: false }
    setRoles((current) => [...current, copy]); selectRole(copy); setMessage("Cópia criada localmente.")
  }
  function remove() {
    if (draft.system) return setError("Papéis do sistema não podem ser excluídos.")
    if (!window.confirm(`${draft.members} membro(s) usam este papel. Excluir removerá a atribuição apenas nesta demonstração. Continuar?`)) return
    const next = roles.filter((role) => role.id !== draft.id); setRoles(next); selectRole(next[0]); setMessage("Papel excluído localmente.")
  }

  return <div className="mx-auto max-w-[1500px] px-4 pb-24 pt-8 lg:px-6"><Link className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" href="/preferencias/usuarios"><ArrowLeft className="size-4" />Usuários e acessos</Link><header className="mb-8"><p className="mb-2 text-sm font-medium text-primary">Preferências / Usuários e acessos</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Papéis e horários de acesso</h1><p className="mt-3 text-sm text-muted-foreground sm:text-base">Organize permissões reutilizáveis e limites de acesso no fuso America/Sao_Paulo.</p></header><div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]"><aside className="rounded-2xl border border-border bg-card p-3"><div className="mb-2 flex items-center justify-between px-2 py-1"><h2 className="font-semibold">Papéis</h2><Button aria-label="Novo papel" size="icon" variant="ghost" onClick={() => { const role = { ...structuredClone(initialRoles[4]), id: Date.now(), name: "Novo papel", members: 0 }; setRoles((current) => [...current, role]); selectRole(role) }}><Plus /></Button></div><div className="space-y-1">{roles.map((role) => <button className={`flex w-full items-center gap-3 rounded-xl p-3 text-left ${role.id === selectedId ? "bg-primary/10 text-primary" : "hover:bg-muted"}`} key={role.id} onClick={() => selectRole(role)}><span className="grid size-9 place-items-center rounded-lg bg-muted"><ShieldCheck className="size-4" /></span><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{role.name}</strong><small className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="size-3" />{role.members} membro(s)</small></span></button>)}</div></aside><main className="min-w-0 space-y-6"><section className="rounded-2xl border border-border bg-card p-5 sm:p-6"><div className="flex flex-wrap items-start gap-3"><div className="mr-auto"><h2 className="text-lg font-semibold">Detalhes do papel</h2><p className="mt-1 text-sm text-muted-foreground">Alterações são locais até existir backend.</p></div><Button variant="outline" onClick={duplicate}><Copy />Duplicar</Button><Button variant="destructive" onClick={remove}><Trash2 />Excluir</Button><Button onClick={save}><Save />Salvar</Button></div>{message && <p className="mt-4 text-sm text-emerald-600 dark:text-emerald-400" role="status">{message}</p>}{error && <p className="mt-4 text-sm text-destructive" role="alert">{error}</p>}<div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-medium">Nome<Input className="h-10" value={draft.name} onChange={(event) => update({ name: event.target.value })} /></label><label className="grid gap-2 text-sm font-medium sm:col-span-2">Descrição<Input className="h-10" value={draft.description} onChange={(event) => update({ description: event.target.value })} /></label></div></section><section className="rounded-2xl border border-border bg-card p-5 sm:p-6"><PermissionMatrix value={draft.permissions} onChange={(permissions) => update({ permissions })} /></section><section className="rounded-2xl border border-border bg-card p-5 sm:p-6"><h2 className="text-lg font-semibold">Horário permitido</h2><p className="mt-1 text-sm text-muted-foreground">America/Sao_Paulo</p><fieldset className="mt-5"><legend className="mb-2 text-sm font-medium">Dias</legend><div className="flex flex-wrap gap-2">{days.map(([id, label]) => <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm has-[:checked]:border-primary/40 has-[:checked]:bg-primary/10" key={id}><input className="accent-primary" type="checkbox" checked={draft.days.includes(id)} onChange={(event) => update({ days: event.target.checked ? [...draft.days, id] : draft.days.filter((day) => day !== id) })} />{label}</label>)}</div></fieldset><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-medium">Início<Input className="h-10" type="time" value={draft.start} onChange={(event) => update({ start: event.target.value })} /></label><label className="grid gap-2 text-sm font-medium">Fim<Input className="h-10" type="time" value={draft.end} onChange={(event) => update({ end: event.target.value })} /></label></div></section></main></div></div>
}
