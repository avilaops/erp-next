"use client"

import NextLink from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { listNavigationHref } from "@/lib/list-navigation"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ComponentProps, type ReactNode } from "react"

type Guard = () => string | null
type NavigationGuard = { register: (guard: Guard) => () => void; confirmNavigation: () => boolean; allowNextUnload: () => () => void }
const NavigationGuardContext = createContext<NavigationGuard>({ register: () => () => {}, confirmNavigation: () => true, allowNextUnload: () => () => {} })

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const activeGuard = useRef<Guard | null>(null)
  const approvedUnload = useRef(false)
  const allowNextUnload = useCallback(() => {
    approvedUnload.current = true
    return () => { approvedUnload.current = false }
  }, [])
  const register = useCallback((guard: Guard) => {
    activeGuard.current = guard
    return () => { if (activeGuard.current === guard) activeGuard.current = null }
  }, [])
  const confirmNavigation = useCallback(() => {
    const message = activeGuard.current?.()
    return !message || window.confirm(message)
  }, [])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (approvedUnload.current) { approvedUnload.current = false; return }
      if (activeGuard.current?.()) { event.preventDefault(); event.returnValue = "" }
    }
    window.addEventListener("beforeunload", beforeUnload)
    return () => window.removeEventListener("beforeunload", beforeUnload)
  }, [])
  const value = useMemo(() => ({ register, confirmNavigation, allowNextUnload }), [register, confirmNavigation, allowNextUnload])
  return <NavigationGuardContext.Provider value={value}>{children}</NavigationGuardContext.Provider>
}

export function useNavigationGuard(message: string | null) {
  const { register } = useContext(NavigationGuardContext)
  useEffect(() => register(() => message), [message, register])
}

export function useConfirmNavigation() {
  return useContext(NavigationGuardContext).confirmNavigation
}

export function useAllowNextUnload() {
  return useContext(NavigationGuardContext).allowNextUnload
}

export function GuardedLink({ onNavigate, ...props }: ComponentProps<typeof NextLink>) {
  const confirmNavigation = useConfirmNavigation()
  const pathname = usePathname()
  const search = useSearchParams()
  const href = typeof props.href === "string" ? listNavigationHref(props.href, pathname, search.toString()) : props.href
  return <NextLink {...props} href={href} onNavigate={event => {
    if (!confirmNavigation()) { event.preventDefault(); return }
    onNavigate?.(event)
  }} />
}
