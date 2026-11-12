"use client"

import { Bell, Building2 } from "lucide-react"
import { GuardedLink as Link } from "./navigation-guard"
import { LogoutButton } from "./logout-button"
import { useResource } from "@/hooks/use-operation"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

type Access = { tenant?: { id?: string; legalName?: string } }

export function HeaderTools() {
  const access = useResource<Access>("/api/erp/me")
  const company = access.value?.tenant?.legalName?.trim() || "Empresa ativa"
  const shortCompany = company.split(/\s+/)[0]
  return <div className="erp-global-actions">
    <Link className="icon-action erp-header-notifications" href="/notificacoes" aria-label="Notificações" title="Notificações"><Bell /></Link>
    <TooltipProvider><Tooltip><TooltipTrigger render={<Link className="erp-company-link" href="/empresas" aria-label="Suas empresas" title={company + " · Trocar empresa"} />}><Building2 aria-hidden="true" /><span><small>Empresa ativa</small><strong className="erp-company-full">{company}</strong><strong className="erp-company-short">{shortCompany}</strong></span></TooltipTrigger><TooltipContent className="max-w-80 break-words">{company} · Trocar empresa</TooltipContent></Tooltip></TooltipProvider>
    <LogoutButton label="" className="icon-action" />
  </div>
}
