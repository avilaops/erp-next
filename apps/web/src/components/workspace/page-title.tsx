import type { ComponentProps } from "react"
import { cn } from "cn"

export function PageTitle({ className, ...props }: ComponentProps<"h1">) {
  return <h1 {...props} className={cn("workspace-page-title", className)} />
}
