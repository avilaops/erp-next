"use client"

import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { RequestError } from "@/components/feedback/session-recovery"

export function LoadingState({ children }: { children: ReactNode }) {
  return <p role="status" className="workspace-resource-state text-muted-foreground">{children}</p>
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="workspace-resource-state rounded-xl border border-border bg-card">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-2 text-sm leading-6 text-muted-foreground">{children}</div>
    </section>
  )
}

export function ErrorState({ title, message, status, onRetry }: { title: string; message: string; status?: number; onRetry: () => void }) {
  return (
    <section role="alert" className="workspace-resource-state rounded-xl border border-destructive/30 bg-destructive/5">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-2 text-sm leading-6"><RequestError message={message} status={status} /></div>
      <Button className="mt-4" variant="outline" onClick={onRetry}>Tentar novamente</Button>
    </section>
  )
}
