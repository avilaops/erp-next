"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronRight, Search, ShieldCheck } from "lucide-react"
import { Input } from "@/components/ui/input"

type Permission = { id: string; label: string; kind: "view" | "manage" | "delete" | "export" | "credentials"; parent?: string }
type PermissionGroup = { id: string; label: string; description: string; permissions: Permission[] }

export const permissionGroups: PermissionGroup[] = [
  group("records", "Cadastros", "Produtos, pessoas e tabelas auxiliares."),
  group("supply", "Suprimentos", "Compras, fornecedores e recebimentos."),
  group("sales", "Vendas", "Propostas, pedidos e faturamento."),
  group("finance", "Finanças", "Contas, conciliação e relatórios."),
  group("services", "Serviços", "Contratos e ordens de serviço."),
  { id: "preferences", label: "Preferências", description: "Empresa, usuários e integrações.", permissions: basePermissions("preferences", "preferências", "credenciais") },
  { id: "tax", label: "Fiscal", description: "Documentos e configurações fiscais.", permissions: basePermissions("tax", "documentos fiscais", "certificado") },
  group("other", "Outros", "Relatórios, auditoria e ferramentas."),
]

export const defaultPermissions = ["records.view", "sales.view", "finance.view", "other.view"]

function group(id: string, label: string, description: string): PermissionGroup {
  return { id, label, description, permissions: basePermissions(id, label.toLocaleLowerCase("pt-BR"), "credenciais") }
}

function basePermissions(id: string, label: string, credentialLabel: string): Permission[] {
  return [
    { id: `${id}.view`, label: `Visualizar ${label}`, kind: "view" },
    { id: `${id}.manage`, label: `Gerenciar ${label}`, kind: "manage" },
    { id: `${id}.delete`, label: `Excluir ou cancelar ${label}`, kind: "delete", parent: `${id}.manage` },
    { id: `${id}.export`, label: `Exportar ${label}`, kind: "export", parent: `${id}.view` },
    { id: `${id}.credentials`, label: `Administrar ${credentialLabel}`, kind: "credentials", parent: `${id}.manage` },
  ]
}

export function PermissionMatrix({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<string[]>(["records", "sales"])
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR")
    if (!term) return permissionGroups
    return permissionGroups.map((item) => ({ ...item, permissions: item.permissions.filter((permission) => `${item.label} ${permission.label}`.toLocaleLowerCase("pt-BR").includes(term)) })).filter((item) => item.permissions.length)
  }, [query])

  function togglePermission(permission: Permission, checked: boolean) {
    const next = new Set(value)
    if (checked) { next.add(permission.id); if (permission.parent) next.add(permission.parent) }
    else { next.delete(permission.id); permissionGroups.flatMap((item) => item.permissions).filter((child) => child.parent === permission.id).forEach((child) => next.delete(child.id)) }
    onChange([...next])
  }

  function toggleGroup(item: PermissionGroup, checked: boolean) {
    const next = new Set(value)
    const safe = item.permissions.filter((permission) => permission.kind === "view" || permission.kind === "manage")
    if (checked) safe.forEach((permission) => next.add(permission.id)); else item.permissions.forEach((permission) => next.delete(permission.id))
    onChange([...next])
  }

  return <section aria-labelledby="permission-matrix-title"><div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-lg font-semibold" id="permission-matrix-title">Matriz de permissões</h2><p className="mt-1 text-sm text-muted-foreground">Ações destrutivas e credenciais exigem seleção individual.</p></div><label className="relative w-full sm:max-w-xs"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><span className="sr-only">Buscar permissões</span><Input className="h-10 pl-9" type="search" placeholder="Buscar permissões" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div><div className="overflow-hidden rounded-xl border border-border">{filtered.map((item) => <PermissionGroupRow group={item} expanded={expanded.includes(item.id) || Boolean(query)} selected={value} key={item.id} onExpand={() => setExpanded((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} onToggleGroup={(checked) => toggleGroup(item, checked)} onTogglePermission={togglePermission} />)}{filtered.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">Nenhuma permissão corresponde à busca.</div>}</div></section>
}

function PermissionGroupRow({ group: item, expanded, selected, onExpand, onToggleGroup, onTogglePermission }: { group: PermissionGroup; expanded: boolean; selected: string[]; onExpand: () => void; onToggleGroup: (checked: boolean) => void; onTogglePermission: (permission: Permission, checked: boolean) => void }) {
  const checkboxRef = useRef<HTMLInputElement>(null)
  const count = item.permissions.filter((permission) => selected.includes(permission.id)).length
  const complete = count === item.permissions.length
  useEffect(() => { if (checkboxRef.current) checkboxRef.current.indeterminate = count > 0 && !complete }, [complete, count])
  return <div className="border-b border-border last:border-b-0"><div className="flex min-h-16 items-center gap-3 p-3 sm:p-4"><input ref={checkboxRef} aria-label={`Selecionar permissões seguras de ${item.label}`} className="size-4 accent-primary" type="checkbox" checked={complete} onChange={(event) => onToggleGroup(event.target.checked)} /><button className="flex min-w-0 flex-1 items-center gap-3 text-left" type="button" aria-expanded={expanded} onClick={onExpand}><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><ShieldCheck className="size-4" /></span><span className="min-w-0 flex-1"><strong className="block text-sm">{item.label}</strong><small className="block truncate text-xs text-muted-foreground">{item.description}</small></span><span className="hidden text-xs text-muted-foreground sm:inline">{count}/{item.permissions.length}</span><ChevronRight className={`size-4 shrink-0 text-muted-foreground transition ${expanded ? "rotate-90" : ""}`} /></button></div>{expanded && <div className="grid gap-2 border-t border-border bg-muted/20 p-3 sm:grid-cols-2 sm:p-4">{item.permissions.map((permission) => { const disabled = Boolean(permission.parent && !selected.includes(permission.parent)); const sensitive = permission.kind === "delete" || permission.kind === "credentials"; return <label className={`flex min-h-12 items-start gap-3 rounded-lg border border-border bg-background p-3 ${disabled ? "text-muted-foreground opacity-65" : ""}`} key={permission.id}><input className="mt-0.5 size-4 accent-primary" type="checkbox" checked={selected.includes(permission.id)} disabled={disabled} onChange={(event) => onTogglePermission(permission, event.target.checked)} /><span className="text-sm"><span className="font-medium">{permission.label}</span>{permission.parent && <small className="mt-0.5 block text-xs text-muted-foreground">Permissão subordinada</small>}{sensitive && <small className="mt-0.5 block text-xs text-amber-600 dark:text-amber-400">Ação sensível</small>}</span></label>})}</div>}</div>
}

