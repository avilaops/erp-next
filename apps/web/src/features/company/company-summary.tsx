"use client"

import { AccessLink } from "@/components/session-recovery"
import { Button } from "@/components/ui/button"
import { Building2 } from "lucide-react"
import { useEffect, useState } from "react"
import type { CompanySnapshot } from "./company-types"

export function CompanySummary() {
  const [company, setCompany] = useState<CompanySnapshot | null>(null)
  const [message, setMessage] = useState("Carregando empresa ativa…")
  const [status, setStatus] = useState(0)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/erp/company", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const value = await response.json()
        if (!controller.signal.aborted) {
          setStatus(response.status)
          if (response.ok) setCompany(value)
          else setMessage(value.title || "Não foi possível consultar a empresa")
        }
      }).catch(() => { if (!controller.signal.aborted) { setStatus(503); setMessage("Não foi possível consultar a empresa") } })
    return () => controller.abort()
  }, [retry])

  return <section className="company-summary" aria-labelledby="active-company-title">
    <span className="company-logo"><Building2 className="size-8 text-primary" aria-hidden="true" /></span>
    <div className="min-w-0 flex-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Empresa ativa</p>
      <h2 className="mt-1 break-words text-xl font-semibold" id="active-company-title">{company ? company.data.tradeName || company.data.legalName : "Acesso à empresa"}</h2>
      <p className="mt-1 break-words text-sm text-muted-foreground" role="status">{company ? `${company.data.legalName} · ${company.data.taxId} · Revisão ${company.revision}` : message}</p>
    </div>
    {company ? <AccessLink page="/empresas">Trocar empresa</AccessLink> : status === 401 ? <AccessLink /> : status >= 400 ? <Button variant="outline" onClick={() => { setStatus(0); setMessage("Carregando empresa ativa…"); setRetry(value => value + 1) }}>Tentar novamente</Button> : null}
  </section>
}
