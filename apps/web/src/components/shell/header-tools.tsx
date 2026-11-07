"use client"

import { Bell, Building2, Settings } from "lucide-react"
import { GuardedLink as Link } from "./navigation-guard"
import { LogoutButton } from "./logout-button"
import { useResource } from "@/hooks/use-operation"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

type Access = { tenant?: { id?: string; legalName?: string } }

export function HeaderTools() {
  const access = useResource<Access>("/api/erp/me")
  const company = access.value?.tenant?.legalName?.trim() || "Empresa ativa"
  return <div className="erp-global-actions">
    <Link className="icon-action erp-header-notifications" href="/notificacoes" aria-label="Notificações" title="Notificações"><Bell /></Link>
    <Link className="icon-action" href="/preferencias" aria-label="Preferências" title="Preferências"><Settings /></Link>
    <TooltipProvider><Tooltip><TooltipTrigger render={<Link className="erp-company-link" href="/empresas" aria-label="Suas empresas" />}><Building2 aria-hidden="true" /><span><small>Empresa ativa</small><strong>{company}</strong></span></TooltipTrigger><TooltipContent className="max-w-80 break-words">{company} · Trocar empresa</TooltipContent></Tooltip></TooltipProvider>
    <LogoutButton label="" className="icon-action" />
  </div>
}
