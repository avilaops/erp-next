"use client"

import Link from "next/link"
import { Building2 } from "lucide-react"
import { useEffect, useState } from "react"
import type { CompanySnapshot } from "./company-types"

export function CompanySummary() {
  const [company, setCompany] = useState<CompanySnapshot | null>(null)
  const [message, setMessage] = useState("Carregando empresa ativa…")

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/erp/company", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const value = await response.json()
        if (!controller.signal.aborted) {
          if (response.ok) setCompany(value)
          else setMessage(value.title || "Não foi possível consultar a empresa")
        }
      }).catch(() => { if (!controller.signal.aborted) setMessage("Não foi possível consultar a empresa") })
    return () => controller.abort()
  }, [])

  return <section className="company-summary" aria-labelledby="active-company-title">
    <span className="company-logo"><Building2 className="size-8 text-primary" aria-hidden="true" /></span>
    <div className="min-w-0 flex-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Empresa ativa</p>
      <h2 className="mt-1 break-words text-xl font-semibold" id="active-company-title">{company ? company.data.tradeName || company.data.legalName : "Acesso à empresa"}</h2>
      <p className="mt-1 break-words text-sm text-muted-foreground" role="status">{company ? `${company.data.legalName} · ${company.data.taxId} · Revisão ${company.revision}` : message}</p>
    </div>
    <Link href="/entrar" className="shrink-0 font-medium text-primary underline">{company ? "Trocar empresa" : "Entrar"}</Link>
  </section>
}
