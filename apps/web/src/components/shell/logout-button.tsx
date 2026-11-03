"use client"

import { useId, useRef, useState } from "react"
import { LogOut } from "lucide-react"
import { useAllowNextUnload, useConfirmNavigation } from "./navigation-guard"

export function LogoutButton({ label = "Sair", className = "flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60" }: { label?: string; className?: string }) {
  const confirmNavigation = useConfirmNavigation()
  const allowNextUnload = useAllowNextUnload()
  const errorId = useId()
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function logout() {
    if (pending.current || !confirmNavigation()) return
    pending.current = true
    setBusy(true)
    setError("")
    let restoreUnload: (() => void) | undefined
    try {
      // Fetch preserves Origin under no-referrer and applies the cleared cookies.
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      })
      if (response.type !== "opaqueredirect") {
        throw new Error(response.status === 403
          ? "A saída foi recusada. Recarregue a página e tente novamente."
          : "Não foi possível confirmar a saída. Tente novamente.")
      }
      // Full navigation uses the verified flow without following a form redirect.
      restoreUnload = allowNextUnload()
      window.location.assign(new URL("/api/auth/logout/central", window.location.origin).href)
    } catch (reason) {
      restoreUnload?.()
      setError(reason instanceof Error && reason.name === "Error" ? reason.message : "Não foi possível confirmar a saída. Tente novamente.")
      pending.current = false
      setBusy(false)
    }
  }

  return <div className="relative">
    <button type="button" onClick={logout} disabled={busy} aria-busy={busy} aria-describedby={error ? errorId : undefined}
      className={className} title="Encerrar a sessão no ERP e no Ávila Auth">
      <LogOut className="size-4" aria-hidden="true" />{busy ? "Saindo…" : label}
    </button>
    {error && <p id={errorId} role="alert" className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-4 text-sm text-popover-foreground shadow-lg">{error}</p>}
  </div>
}
