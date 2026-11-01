"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertCircle,
  Ban,
  Check,
  ChevronDown,
  CircleDot,
  Clock3,
  Mail,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRoundCog,
  Users,
  X,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

type UserStatus = "active" | "blocked" | "pending"
type ScreenState = "ready" | "loading" | "error" | "forbidden"

type User = {
  id: number
  name: string
  email: string
  role: string
  status: UserStatus
  lastAccess: string
  permissions: string[]
}

const roleOptions = ["Administrador", "Gestor", "Financeiro", "Operação", "Consulta"]

const initialUsers: User[] = [
  { id: 1, name: "Nicolas Ávila", email: "nicolas@avilaops.com", role: "Administrador", status: "active", lastAccess: "Agora", permissions: [] },
  { id: 2, name: "Mariana Costa", email: "mariana@ludusequipamentos.com.br", role: "Gestor", status: "active", lastAccess: "Hoje, 08:42", permissions: [] },
  { id: 3, name: "Carlos Mendes", email: "carlos@ludusequipamentos.com.br", role: "Financeiro", status: "blocked", lastAccess: "18 out, 16:10", permissions: ["finance.view", "finance.manage", "finance.export", "tax.manage"] },
  { id: 4, name: "Fernanda Lima", email: "fernanda@ludusequipamentos.com.br", role: "Operação", status: "pending", lastAccess: "Convite enviado há 2 dias", permissions: ["records.view", "sales.view", "sales.manage", "stock.manage"] },
  { id: 5, name: "Roberto Alves", email: "roberto@ludusequipamentos.com.br", role: "Consulta", status: "active", lastAccess: "21 out, 09:18", permissions: ["records.view", "sales.view", "finance.view"] },
]

const statusLabels: Record<UserStatus, string> = { active: "Ativo", blocked: "Bloqueado", pending: "Convite pendente" }

export function UsersAccess() {
  const router = useRouter()
  const [users, setUsers] = useState(initialUsers)
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | UserStatus>("all")
  const [roleFilter, setRoleFilter] = useState("all")
  const [screenState, setScreenState] = useState<ScreenState>("ready")

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR")
    return users.filter((user) => {
      const matchesQuery = !normalizedQuery || `${user.name} ${user.email}`.toLocaleLowerCase("pt-BR").includes(normalizedQuery)
      return matchesQuery && (statusFilter === "all" || user.status === statusFilter) && (roleFilter === "all" || user.role === roleFilter)
    })
  }, [query, roleFilter, statusFilter, users])

  const counts = useMemo(() => ({
    active: users.filter((user) => user.status === "active").length,
    blocked: users.filter((user) => user.status === "blocked").length,
    pending: users.filter((user) => user.status === "pending").length,
  }), [users])

  function openCreate() {
    router.push("/preferencias/usuarios/novo")
  }

  function toggleBlocked(user: User) {
    setUsers((current) => current.map((item) => item.id === user.id ? { ...item, status: item.status === "blocked" ? "active" : "blocked" } : item))
  }

  return (
    <div className="mx-auto max-w-[1500px] px-4 pb-24 pt-8 lg:px-6">
      <div className="flex flex-col gap-5 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between">
        <header>
          <p className="mb-2 text-sm font-medium text-primary">Preferências / Usuários e acessos</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Usuários e acessos</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">Gerencie quem acessa a empresa e defina responsabilidades com permissões por domínio.</p>
        </header>
        <Button onClick={openCreate}><Plus />Convidar usuário</Button>
      </div>

      {screenState === "forbidden" ? <ForbiddenState onBack={() => setScreenState("ready")} /> : (
        <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <main className="min-w-0">
            <section className="grid gap-3 sm:grid-cols-3" aria-label="Resumo dos usuários">
              <SummaryCard icon={CircleDot} label="Usuários ativos" value={counts.active} tone="success" />
              <SummaryCard icon={Clock3} label="Convites pendentes" value={counts.pending} tone="warning" />
              <SummaryCard icon={Ban} label="Usuários bloqueados" value={counts.blocked} tone="danger" />
            </section>

            <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-card" aria-labelledby="users-list-title">
              <div className="flex flex-col gap-4 border-b border-border p-4 sm:p-5">
                <div className="flex items-center justify-between gap-4">
                  <div><h2 className="font-semibold" id="users-list-title">Pessoas com acesso</h2><p className="mt-1 text-sm text-muted-foreground">{filteredUsers.length} de {users.length} usuários</p></div>
                  {(query || statusFilter !== "all" || roleFilter !== "all") && <Button variant="ghost" size="sm" onClick={() => { setQuery(""); setStatusFilter("all"); setRoleFilter("all") }}><X />Limpar filtros</Button>}
                </div>
                <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_180px_180px]">
                  <label className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <span className="sr-only">Buscar por nome ou e-mail</span>
                    <Input className="h-10 pl-9" type="search" placeholder="Buscar por nome ou e-mail" value={query} onChange={(event) => setQuery(event.target.value)} />
                  </label>
                  <FilterSelect label="Filtrar por estado" value={statusFilter} onChange={(value) => setStatusFilter(value as "all" | UserStatus)} options={[{ value: "all", label: "Todos os estados" }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]} />
                  <FilterSelect label="Filtrar por papel" value={roleFilter} onChange={setRoleFilter} options={[{ value: "all", label: "Todos os papéis" }, ...roleOptions.map((role) => ({ value: role, label: role }))]} />
                </div>
              </div>

              {screenState === "loading" && <LoadingState />}
              {screenState === "error" && <ErrorState onRetry={() => setScreenState("ready")} />}
              {screenState === "ready" && filteredUsers.length === 0 && <EmptyState onClear={() => { setQuery(""); setStatusFilter("all"); setRoleFilter("all") }} />}
              {screenState === "ready" && filteredUsers.length > 0 && (
                <div className="divide-y divide-border">
                  {filteredUsers.map((user) => <UserRow key={user.id} user={user} onEdit={() => router.push(`/preferencias/usuarios/${user.id}`)} onToggleBlocked={() => toggleBlocked(user)} />)}
                </div>
              )}
            </section>
          </main>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-border bg-card p-5">
              <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary"><ShieldCheck className="size-5" /></span>
              <h2 className="mt-4 font-semibold">Princípio do menor acesso</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Conceda apenas as permissões necessárias. Ações subordinadas dependem da permissão principal do domínio.</p>
            </section>
            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-2"><ShieldCheck className="size-4 text-muted-foreground" /><h2 className="font-semibold">Papéis em uso</h2></div>
              <div className="mt-4 space-y-3">
                {roleOptions.map((role) => <div className="flex items-center justify-between gap-3 text-sm" key={role}><span>{role}</span><span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{users.filter((user) => user.role === role).length}</span></div>)}
              </div>
              <Button className="mt-5 w-full" variant="outline" onClick={() => router.push("/preferencias/papeis")}>Gerenciar papéis</Button>
            </section>
            <details className="rounded-2xl border border-border bg-card p-5 text-sm" open>
              <summary className="cursor-pointer font-medium text-muted-foreground">Ferramentas de demonstração</summary>
              <label className="mt-4 grid gap-2 text-xs font-medium text-muted-foreground">
                Simular estado
                <select className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground" value={screenState} onChange={(event) => setScreenState(event.target.value as ScreenState)}>
                  <option value="ready">Conteúdo</option>
                  <option value="loading">Carregamento</option>
                  <option value="error">Erro</option>
                  <option value="forbidden">Sem permissão</option>
                </select>
              </label>
            </details>
          </aside>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ icon: Icon, label, value, tone }: { icon: typeof Users; label: string; value: number; tone: "success" | "warning" | "danger" }) {
  const tones = { success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400", danger: "bg-destructive/10 text-destructive" }
  return <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"><span className={`grid size-10 place-items-center rounded-xl ${tones[tone]}`}><Icon className="size-5" /></span><div><strong className="block text-xl leading-none">{value}</strong><span className="mt-1 block text-xs text-muted-foreground">{label}</span></div></div>
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <label className="relative"><span className="sr-only">{label}</span><select className="h-10 w-full appearance-none rounded-lg border border-input bg-background px-3 pr-8 text-sm" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /></label>
}

function UserRow({ user, onEdit, onToggleBlocked }: { user: User; onEdit: () => void; onToggleBlocked: () => void }) {
  return (
    <article className="grid gap-3 p-4 transition hover:bg-muted/35 sm:grid-cols-[minmax(0,1fr)_140px_160px_auto] sm:items-center sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar size="lg"><AvatarFallback className="bg-primary/10 font-semibold text-primary">{initials(user.name)}</AvatarFallback></Avatar>
        <div className="min-w-0"><h3 className="truncate text-sm font-medium">{user.name}</h3><p className="truncate text-sm text-muted-foreground">{user.email}</p></div>
      </div>
      <div><p className="text-xs text-muted-foreground sm:hidden">Papel</p><p className="text-sm">{user.role}</p></div>
      <div><StatusBadge status={user.status} /><p className="mt-1 text-xs text-muted-foreground">{user.lastAccess}</p></div>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button className="size-11 sm:size-8" aria-label={`Ações de ${user.name}`} variant="ghost" size="icon" />}><MoreHorizontal /></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuItem onClick={onEdit}><UserRoundCog />Editar usuário e permissões</DropdownMenuItem><DropdownMenuItem onClick={onToggleBlocked}>{user.status === "blocked" ? <Check /> : <Ban />}{user.status === "blocked" ? "Desbloquear" : "Bloquear"}</DropdownMenuItem>{user.status === "pending" && <DropdownMenuItem><Mail />Reenviar convite</DropdownMenuItem>}</DropdownMenuContent>
      </DropdownMenu>
    </article>
  )
}

function StatusBadge({ status }: { status: UserStatus }) {
  const styles = { active: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", blocked: "border-destructive/20 bg-destructive/10 text-destructive", pending: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400" }
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${styles[status]}`}><span className="size-1.5 rounded-full bg-current" />{statusLabels[status]}</span>
}

function LoadingState() {
  return <div className="divide-y divide-border" aria-busy="true" aria-label="Carregando usuários">{Array.from({ length: 4 }, (_, index) => <div className="flex items-center gap-3 p-5" key={index}><Skeleton className="size-10 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-56 max-w-full" /></div><Skeleton className="hidden h-7 w-24 sm:block" /></div>)}</div>
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return <StatePanel icon={AlertCircle} title="Não foi possível carregar os usuários" description="Ocorreu um erro na simulação. Tente carregar a lista novamente."><Button variant="outline" onClick={onRetry}><RefreshCw />Tentar novamente</Button></StatePanel>
}

function EmptyState({ onClear }: { onClear: () => void }) {
  return <StatePanel icon={Users} title="Nenhum usuário encontrado" description="A busca ou os filtros atuais não correspondem a nenhum usuário."><Button variant="outline" onClick={onClear}><X />Limpar filtros</Button></StatePanel>
}

function ForbiddenState({ onBack }: { onBack: () => void }) {
  return <div className="mx-auto mt-16 max-w-xl rounded-2xl border border-border bg-card"><StatePanel icon={ShieldCheck} title="Você não tem permissão para gerenciar acessos" description="Solicite a um administrador a permissão Gerenciar usuários para acessar esta área."><Button variant="outline" onClick={onBack}>Voltar à lista</Button></StatePanel></div>
}

function StatePanel({ icon: Icon, title, description, children }: { icon: typeof Users; title: string; description: string; children?: React.ReactNode }) {
  return <div className="grid min-h-72 place-items-center p-6 text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground"><Icon className="size-5" /></span><h2 className="mt-4 font-semibold">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>{children && <div className="mt-5 flex justify-center">{children}</div>}</div></div>
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("pt-BR")
}
