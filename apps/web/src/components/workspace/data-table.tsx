import type { ComponentProps, ReactNode } from "react"
import { cn } from "cn"
import type { TableSort } from "./table-sort-model"

/** Keeps native table semantics, captions, sorting controls and consumer refs. */
export function DataTable({ className, ...props }: ComponentProps<"table">) {
  return <table {...props} data-slot="data-table" className={cn("workspace-data-table w-full text-left text-sm", className)} />
}

export function SortableTableHeader({ field, sort, onSort, children, className }: { field: string; sort: TableSort; onSort: (field: string) => void; children: ReactNode; className?: string }) {
  const active = sort.by === field
  const descending = active && sort.order === "desc"
  const nextOrder = sort.explicit && active && sort.order === "asc" ? "decrescente" : "crescente"
  return (
    <th scope="col" aria-sort={active ? descending ? "descending" : "ascending" : "none"} className={cn("workspace-sort-header", className)}>
      <button type="button" className="workspace-sort-button" title={`Ordenar em ordem ${nextOrder}`} onClick={() => onSort(field)}>
        {children}<span aria-hidden="true" className={cn("workspace-sort-arrow", !active && "invisible")}>{descending ? "↓" : "↑"}</span>
      </button>
    </th>
  )
}
