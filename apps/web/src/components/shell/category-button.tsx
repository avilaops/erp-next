import type { ComponentProps } from "react"
import { cn } from "cn"

/** Shared category selection for the workspace menu and Preferences. */
export function CategoryButton({ className, type = "button", ...props }: ComponentProps<"button">) {
  return <button {...props} type={type} className={cn("erp-category-button", className)} />
}
