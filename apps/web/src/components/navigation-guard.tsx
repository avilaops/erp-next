"use client"

import NextLink from "next/link"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ComponentProps, type ReactNode } from "react"

type Guard = () => string | null
type NavigationGuard = { register: (guard: Guard) => () => void; confirmNavigation: () => boolean }
const NavigationGuardContext = createContext<NavigationGuard>({ register: () => () => {}, confirmNavigation: () => true })

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const activeGuard = useRef<Guard | null>(null)
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
      if (activeGuard.current?.()) { event.preventDefault(); event.returnValue = "" }
    }
    window.addEventListener("beforeunload", beforeUnload)
    return () => window.removeEventListener("beforeunload", beforeUnload)
  }, [])
  const value = useMemo(() => ({ register, confirmNavigation }), [register, confirmNavigation])
  return <NavigationGuardContext.Provider value={value}>{children}</NavigationGuardContext.Provider>
}

export function useNavigationGuard(message: string | null) {
  const { register } = useContext(NavigationGuardContext)
  useEffect(() => register(() => message), [message, register])
}

export function useConfirmNavigation() {
  return useContext(NavigationGuardContext).confirmNavigation
}

export function GuardedLink({ onNavigate, ...props }: ComponentProps<typeof NextLink>) {
  const confirmNavigation = useConfirmNavigation()
  return <NextLink {...props} onNavigate={event => {
    if (!confirmNavigation()) { event.preventDefault(); return }
    onNavigate?.(event)
  }} />
}
