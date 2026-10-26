"use client"

import dynamic from "next/dynamic"
import { useEffect, useRef, useState } from "react"
import { Search } from "lucide-react"

const PreferencesCommandPanel = dynamic(() => import("./preferences-command-panel").then((module) => module.PreferencesCommandPanel), { ssr: false })

export function PreferencesCommand() {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  function openCommand() { returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setLoaded(true); setOpen(true) }
  function handleOpenChange(nextOpen: boolean) { setOpen(nextOpen); if (!nextOpen) requestAnimationFrame(() => returnFocusRef.current?.focus()) }
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase("pt-BR") === "k") { event.preventDefault(); if (open) handleOpenChange(false); else openCommand() } }
    const handleExternalOpen = () => openCommand()
    document.addEventListener("keydown", handleKeyDown); window.addEventListener("erp-open-search", handleExternalOpen)
    return () => { document.removeEventListener("keydown", handleKeyDown); window.removeEventListener("erp-open-search", handleExternalOpen) }
  }, [open])
  return <><button className="ml-auto hidden h-9 min-w-40 max-w-md flex-1 items-center gap-2 rounded-xl border border-border bg-muted/55 px-3 text-left md:flex" type="button" onClick={openCommand}><Search className="size-4 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1 text-sm text-muted-foreground">Pesquisar</span><kbd className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">Ctrl K</kbd></button>{loaded && <PreferencesCommandPanel open={open} onOpenChange={handleOpenChange} />}</>
}
