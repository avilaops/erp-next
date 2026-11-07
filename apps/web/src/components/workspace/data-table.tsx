import type { ComponentProps } from "react"
import { cn } from "cn"

/** Keeps native table semantics, captions, sorting controls and consumer refs. */
export function DataTable({ className, ...props }: ComponentProps<"table">) {
  return <table {...props} data-slot="data-table" className={cn("workspace-data-table w-full text-left text-sm", className)} />
}
