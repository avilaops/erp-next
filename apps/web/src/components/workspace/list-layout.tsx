import type { ComponentProps, FormEventHandler, ReactNode } from "react"
import { cn } from "cn"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"

export { SortableTableHeader } from "./data-table"

type EntityListPageProps = {
  title: string
  description?: string
  actions?: ReactNode
  toolbar?: ReactNode
  summary?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
}

/** Data, permissions, errors and pagination stay with the feature. */
export function EntityListPage({ title, description, actions, toolbar, summary, footer, children, className }: EntityListPageProps) {
  return (
    <section className={cn("workspace-entity-list", className)}>
      <PageHeader title={title} description={description} actions={actions} />
      <div className="workspace-list-card">
        {toolbar && <div className="workspace-list-toolbar">{toolbar}</div>}
        {summary != null && <div className="workspace-list-summary">{summary}</div>}
        {children}
        {footer && <div className="workspace-list-footer">{footer}</div>}
      </div>
    </section>
  )
}

export function SearchToolbar({ onSubmit, onClear, canClear = false, pending = false, children, className }: { onSubmit: FormEventHandler<HTMLFormElement>; onClear?: () => void; canClear?: boolean; pending?: boolean; children: ReactNode; className?: string }) {
  return (
    <form onSubmit={onSubmit} role="search" aria-busy={pending || undefined} className={cn("workspace-search-toolbar", className)}>
      {children}
      <div className="workspace-search-actions">
        <Button type="submit" disabled={pending}>Buscar</Button>
        {onClear && <Button type="button" variant="outline" disabled={pending || !canClear} onClick={onClear}>Limpar</Button>}
      </div>
    </form>
  )
}

/** A wrapping label associates existing SearchInput/select controls without generated IDs. */
export function FilterField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <label className={cn("workspace-filter-field", className)}><span>{label}</span>{children}</label>
}

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info"

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: StatusTone }) {
  return <span className="workspace-status-badge" data-tone={tone}>{children}</span>
}

export function EmptyState({ filtered, title, description, action }: { filtered: boolean; title?: string; description?: string; action?: ReactNode }) {
  return (
    <div className="workspace-list-empty">
      <p className="font-medium text-foreground">{title ?? (filtered ? "Nenhum resultado encontrado" : "Nenhum registro cadastrado")}</p>
      <p className="text-sm text-muted-foreground">{description ?? (filtered ? "Revise a pesquisa ou limpe os filtros para ver os registros." : "Os registros cadastrados aparecerão aqui.")}</p>
      {action && <div className="workspace-list-empty-action">{action}</div>}
    </div>
  )
}

export function ResponsiveTable({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <div role="region" aria-label={label} tabIndex={0} className={cn("workspace-list-scroll workspace-responsive-table", className)}>{children}</div>
}

/** Accepts an already formatted value; monetary parsing belongs to the domain. */
export function CurrencyCell({ className, ...props }: ComponentProps<"td">) {
  return <td {...props} className={cn("workspace-currency-cell", className)} />
}

export function CurrencyValue({ className, ...props }: ComponentProps<"span">) {
  return <span {...props} className={cn("workspace-currency-value", className)} />
}
