"use client"

import type { ReactNode } from "react"
import { usePathname } from "next/navigation"
import { isDemonstrationRoute } from "@/lib/demonstration-routes"

export function DemonstrationPreview({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  if (!isDemonstrationRoute(pathname)) return <>{children}</>
  return <div>
    <section className="mx-auto max-w-[1600px] px-4 pt-6 lg:px-6" aria-labelledby="preview-title">
      <div className="rounded-xl border border-border bg-muted/40 p-4">
        <h2 id="preview-title" className="font-semibold">Prévia de interface</h2>
        <p id="preview-description" className="mt-2 text-sm">Esta tela usa dados de exemplo. Seus indicadores não representam a empresa ativa. As ações de operação estão indisponíveis; os links permitem continuar a navegação.</p>
      </div>
    </section>
    <fieldset disabled className="min-w-0 border-0 p-0" aria-describedby="preview-description">
      <legend className="sr-only">Dados de exemplo; operações indisponíveis</legend>
      {children}
    </fieldset>
  </div>
}
