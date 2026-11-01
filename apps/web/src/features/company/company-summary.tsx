"use client"

import { AccessLink } from "@/components/feedback/session-recovery"
import { Button } from "@/components/ui/button"
import { Building2 } from "lucide-react"
import { useCompanyProfile } from "./company-profile-context"

export function CompanySummary() {
  const { company, message, status, reload } = useCompanyProfile()

  return <section className="company-summary" aria-labelledby="active-company-title">
    <span className="company-logo"><Building2 className="size-8 text-primary" aria-hidden="true" /></span>
    <div className="min-w-0 flex-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Empresa ativa</p>
      <h2 className="mt-1 break-words text-xl font-semibold" id="active-company-title">{company ? company.data.tradeName || company.data.legalName : "Acesso à empresa"}</h2>
      <p className="mt-1 break-words text-sm text-muted-foreground" role="status">{company ? `${company.data.legalName} · ${company.data.taxId} · Revisão ${company.revision}` : message}</p>
    </div>
    {company ? <AccessLink page="/empresas">Trocar empresa</AccessLink> : status === 401 ? <AccessLink /> : status >= 400 ? <Button variant="outline" onClick={reload}>Tentar novamente</Button> : null}
  </section>
}
