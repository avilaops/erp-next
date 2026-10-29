"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { usePathname } from "next/navigation"

function closeMenus(navigation: HTMLElement, restoreFocus = false) {
  const trigger = navigation.querySelector<HTMLElement>("details[open] > summary")
  navigation.querySelectorAll<HTMLDetailsElement>("details[open]").forEach(menu => { menu.open = false })
  if (restoreFocus) trigger?.focus()
}

export function DesktopNavigation({ children }: { children: ReactNode }) {
  const navigation = useRef<HTMLElement>(null)
  const pathname = usePathname()

  useEffect(() => {
    const root = navigation.current
    if (!root) return
    closeMenus(root)
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.contains(event.target)) closeMenus(root)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && root.querySelector("details[open]")) {
        event.preventDefault()
        closeMenus(root, true)
      }
    }
    const followLink = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("a[href]")) closeMenus(root)
    }
    const resize = () => closeMenus(root)
    const desktop = window.matchMedia("(min-width: 1600px)")
    document.addEventListener("pointerdown", outside)
    document.addEventListener("focusin", outside)
    document.addEventListener("keydown", escape)
    root.addEventListener("click", followLink, true)
    desktop.addEventListener("change", resize)
    return () => {
      document.removeEventListener("pointerdown", outside)
      document.removeEventListener("focusin", outside)
      document.removeEventListener("keydown", escape)
      root.removeEventListener("click", followLink, true)
      desktop.removeEventListener("change", resize)
    }
  }, [pathname])

  return <nav ref={navigation} className="relative hidden h-full items-center min-[1600px]:flex" aria-label="Módulos do ERP">{children}</nav>
}
