"use client"

import { useRef, useState } from "react"
import { LogOut } from "lucide-react"
import { useConfirmNavigation } from "./navigation-guard"

export function LogoutButton() {
  const confirmNavigation = useConfirmNavigation()
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function logout() {
    if (pending.current || !confirmNavigation()) return
    pending.current = true
    setBusy(true)
    setError("")
    try {
      // Native form navigation sends Origin: null under our no-referrer policy.
      // Fetch keeps the same-origin POST check and applies the response cookies.
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
      // A full navigation discards cached company data after the cookies are cleared.
      window.location.assign(new URL("/entrar", window.location.origin).href)
    } catch (reason) {
      setError(reason instanceof Error && reason.name === "Error" ? reason.message : "Não foi possível confirmar a saída. Tente novamente.")
      pending.current = false
      setBusy(false)
    }
  }

  return <div className="relative">
    <button type="button" onClick={logout} disabled={busy} aria-busy={busy} aria-describedby={error ? "logout-error" : undefined}
      className="flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
      title="Encerrar a sessão deste ERP">
      <LogOut className="size-4" aria-hidden="true" />{busy ? "Saindo…" : "Sair"}
    </button>
    {error && <p id="logout-error" role="alert" className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-4 text-sm text-popover-foreground shadow-lg">{error}</p>}
  </div>
}
