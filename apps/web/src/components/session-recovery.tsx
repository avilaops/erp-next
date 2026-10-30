"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { GuardedLink } from "./navigation-guard"
import { accessHref } from "@/lib/return-to"
import type { ReactNode } from "react"

export function AccessLink({ page = "/entrar", children = "Entrar com Ávila Ops", className = "font-medium text-primary underline" }: { page?: "/entrar" | "/empresas"; children?: ReactNode; className?: string }) {
  const pathname = usePathname()
  const query = useSearchParams().toString()
  return <GuardedLink className={className} href={accessHref(page, pathname + (query ? "?" + query : ""))}>{children}</GuardedLink>
}

export function RequestError({ message, status }: { message: string; status?: number }) {
  return <><span>{message}</span>{status === 401 && <span className="mt-2 block"><AccessLink /></span>}</>
}
