"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle2, Info, RotateCcw, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { defaultPermissions, PermissionMatrix } from "@/features/access/users/permission-matrix"

export type UserFormValue = {
  name: string
  email: string
  mobile: string
  status: "active" | "blocked" | "pending"
  role: string
  permissions?: string[]
  communications: { security: boolean; operations: boolean; summaries: boolean }
  accessSchedule: { enabled: boolean; days: string[]; start: string; end: string; timezone: string }
}

const weekDays = [
  ["mon", "Seg"], ["tue", "Ter"], ["wed", "Qua"], ["thu", "Qui"], ["fri", "Sex"], ["sat", "Sáb"], ["sun", "Dom"],
]

export const mockUsers: Record<string, UserFormValue> = {
  "1": { name: "Nicolas Ávila", email: "nicolas@avilaops.com", mobile: "", status: "active", role: "Administrador", communications: { security: true, operations: true, summaries: true }, accessSchedule: { enabled: false, days: ["mon", "tue", "wed", "thu", "fri"], start: "08:00", end: "18:00", timezone: "America/Sao_Paulo" } },
  "2": { name: "Mariana Costa", email: "mariana@ludusequipamentos.com.br", mobile: "", status: "active", role: "Gestor", communications: { security: true, operations: true, summaries: false }, accessSchedule: { enabled: true, days: ["mon", "tue", "wed", "thu", "fri"], start: "08:00", end: "18:00", timezone: "America/Sao_Paulo" } },
  "3": { name: "Carlos Mendes", email: "carlos@ludusequipamentos.com.br", mobile: "", status: "blocked", role: "Financeiro", communications: { security: true, operations: false, summaries: true }, accessSchedule: { enabled: true, days: ["mon", "tue", "wed", "thu", "fri"], start: "08:30", end: "17:30", timezone: "America/Sao_Paulo" } },
  "4": { name: "Fernanda Lima", email: "fernanda@ludusequipamentos.com.br", mobile: "", status: "pending", role: "Operação", communications: { security: true, operations: true, summaries: false }, accessSchedule: { enabled: false, days: ["mon", "tue", "wed", "thu", "fri"], start: "08:00", end: "18:00", timezone: "America/Sao_Paulo" } },
  "5": { name: "Roberto Alves", email: "roberto@ludusequipamentos.com.br", mobile: "", status: "active", role: "Consulta", communications: { security: true, operations: false, summaries: false }, accessSchedule: { enabled: false, days: ["mon", "tue", "wed", "thu", "fri"], start: "08:00", end: "18:00", timezone: "America/Sao_Paulo" } },
}

const blankUser: UserFormValue = {
  name: "", email: "", mobile: "", status: "pending", role: "Consulta",
  communications: { security: true, operations: false, summaries: false },
  accessSchedule: { enabled: false, days: ["mon", "tue", "wed", "thu", "fri"], start: "08:00", end: "18:00", timezone: "America/Sao_Paulo" },
}

export function UserForm({ userId }: { userId?: string }) {
  const router = useRouter()
  const initial = useMemo(() => structuredClone(userId ? mockUsers[userId] ?? blankUser : blankUser), [userId])
  const [value, setValue] = useState<UserFormValue>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const dirty = JSON.stringify(value) !== JSON.stringify(initial)
  const isPending = value.status === "pending"

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  function setField<K extends keyof UserFormValue>(field: K, next: UserFormValue[K]) {
    setValue((current) => ({ ...current, [field]: next }))
    setSaved(false)
  }

  function validate() {
    const next: Record<string, string> = {}
    if (!value.name.trim()) next.name = "Informe o nome completo."
    if (!/^\S+@\S+\.\S+$/.test(value.email)) next.email = "Informe um e-mail válido."
    if (value.mobile && value.mobile.replace(/\D/g, "").length < 10) next.mobile = "Informe um celular com DDD."
    if (value.accessSchedule.enabled && value.accessSchedule.days.length === 0) next.days = "Selecione pelo menos um dia."
    if (value.accessSchedule.enabled && value.accessSchedule.start >= value.accessSchedule.end) next.schedule = "O horário final deve ser posterior ao inicial."
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!validate()) return
    setSaved(true)
  }

  function leave() {
    if (!dirty || window.confirm("Descartar alterações não salvas?")) router.push("/preferencias/usuarios")
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pb-28 pt-8 lg:px-6">
      <button className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" type="button" onClick={leave}><ArrowLeft className="size-4" />Usuários e acessos</button>
      <header className="mb-8"><p className="mb-2 text-sm font-medium text-primary">Preferências / Usuários e acessos</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{userId ? "Editar usuário" : "Convidar usuário"}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">{isPending ? "Configure o convite e os limites iniciais de acesso." : "Atualize os dados, comunicações e horários permitidos."}</p></header>

      <form className="space-y-6" noValidate onSubmit={submit}>
        <div className="sticky top-20 z-30 flex min-h-14 items-center gap-2 rounded-2xl border border-border bg-background/95 p-2.5 shadow-lg backdrop-blur-xl">
          <span className="mr-auto text-sm text-muted-foreground" role="status" aria-live="polite">{saved ? "Alterações salvas localmente" : dirty ? "Alterações não salvas" : "Nenhuma alteração pendente"}</span>
          <Button type="button" variant="outline" disabled={!dirty} onClick={() => { setValue(structuredClone(initial)); setErrors({}); setSaved(false) }}><RotateCcw />Restaurar</Button>
          <Button type="submit" disabled={!dirty}><Save />Salvar</Button>
        </div>

        {saved && <div className="flex gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm"><CheckCircle2 className="size-5 shrink-0 text-emerald-500" /><div><strong>Salvo apenas nesta demonstração</strong><p className="mt-1 text-muted-foreground">Nenhum dado foi enviado ou persistido em backend.</p></div></div>}

        <FormSection title="Identificação" description={userId ? "Dados do usuário existente." : "Dados usados para enviar o convite."}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome completo" error={errors.name}><Input className="h-10" value={value.name} aria-invalid={Boolean(errors.name)} onChange={(event) => setField("name", event.target.value)} /></Field>
            <Field label="E-mail" error={errors.email}><Input className="h-10" type="email" value={value.email} aria-invalid={Boolean(errors.email)} onChange={(event) => setField("email", event.target.value)} /></Field>
            <Field label="Celular" hint="Opcional. Nenhuma mensagem será enviada."><Input className="h-10" type="tel" placeholder="(00) 00000-0000" value={value.mobile} aria-invalid={Boolean(errors.mobile)} onChange={(event) => setField("mobile", event.target.value)} /></Field>
            <Field label="Estado"><select className="h-10 rounded-lg border border-input bg-background px-3 text-sm" value={value.status} onChange={(event) => setField("status", event.target.value as UserFormValue["status"])}><option value="active">Ativo</option><option value="blocked">Bloqueado</option><option value="pending">Convite pendente</option></select></Field>
            <Field label="Papel principal"><select className="h-10 rounded-lg border border-input bg-background px-3 text-sm" value={value.role} onChange={(event) => setField("role", event.target.value)}>{["Administrador", "Gestor", "Financeiro", "Operação", "Consulta"].map((role) => <option key={role}>{role}</option>)}</select></Field>
          </div>
        </FormSection>

        <FormSection title="Permissões" description="Ajuste acessos por domínio. As alterações entram no mesmo salvamento local do usuário.">
          <PermissionMatrix value={value.permissions ?? defaultPermissions} onChange={(permissions) => setField("permissions", permissions)} />
        </FormSection>

        <FormSection title="Comunicações" description="Escolha quais avisos o usuário poderá receber quando o backend estiver disponível.">
          <div className="grid gap-3 md:grid-cols-3">{([["security", "Segurança", "Alertas de conta e acesso"], ["operations", "Operação", "Mudanças em tarefas atribuídas"], ["summaries", "Resumos", "Consolidados periódicos"]] as const).map(([id, label, description]) => <label className="flex cursor-pointer gap-3 rounded-xl border border-border p-4" key={id}><input className="mt-0.5 size-4 accent-primary" type="checkbox" checked={value.communications[id]} onChange={(event) => setField("communications", { ...value.communications, [id]: event.target.checked })} /><span><strong className="block text-sm">{label}</strong><small className="mt-1 block text-xs text-muted-foreground">{description}</small></span></label>)}</div>
        </FormSection>

        <FormSection title="Restrição de horários" description="Limite opcional no fuso da empresa.">
          <label className="flex items-center justify-between gap-4 rounded-xl border border-border p-4"><span><strong className="block text-sm">Restringir acesso por horário</strong><small className="mt-1 block text-xs text-muted-foreground">Fora do período, o acesso ficará indisponível.</small></span><input className="size-5 accent-primary" type="checkbox" checked={value.accessSchedule.enabled} onChange={(event) => setField("accessSchedule", { ...value.accessSchedule, enabled: event.target.checked })} /></label>
          {value.accessSchedule.enabled && <div className="mt-5 space-y-4"><fieldset><legend className="mb-2 text-sm font-medium">Dias permitidos</legend><div className="flex flex-wrap gap-2">{weekDays.map(([id, label]) => <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm has-[:checked]:border-primary/40 has-[:checked]:bg-primary/10" key={id}><input type="checkbox" className="accent-primary" checked={value.accessSchedule.days.includes(id)} onChange={(event) => setField("accessSchedule", { ...value.accessSchedule, days: event.target.checked ? [...value.accessSchedule.days, id] : value.accessSchedule.days.filter((day) => day !== id) })} />{label}</label>)}</div>{errors.days && <p className="mt-2 text-sm text-destructive">{errors.days}</p>}</fieldset><div className="grid gap-4 sm:grid-cols-3"><Field label="Início"><Input className="h-10" type="time" value={value.accessSchedule.start} onChange={(event) => setField("accessSchedule", { ...value.accessSchedule, start: event.target.value })} /></Field><Field label="Fim" error={errors.schedule}><Input className="h-10" type="time" aria-invalid={Boolean(errors.schedule)} value={value.accessSchedule.end} onChange={(event) => setField("accessSchedule", { ...value.accessSchedule, end: event.target.value })} /></Field><Field label="Fuso horário"><Input className="h-10" readOnly value={value.accessSchedule.timezone} /></Field></div></div>}
        </FormSection>

        <aside className="flex gap-3 rounded-2xl border border-primary/20 bg-primary/10 p-4 text-sm text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0 text-primary" /><p>Dados simulados. Convites, comunicações e restrições não são enviados nem aplicados sem integração de backend.</p></aside>
      </form>
    </div>
  )
}

function FormSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-border bg-card p-5 sm:p-6"><div className="mb-5"><h2 className="text-lg font-semibold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>{children}</section>
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return <label className="grid content-start gap-2 text-sm font-medium">{label}{children}{error ? <span className="text-sm font-normal text-destructive">{error}</span> : hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}</label>
}

