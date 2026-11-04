"use client"

import { Bell, Building2, CircleHelp, LayoutGrid, MoreHorizontal, Settings, Sparkles } from "lucide-react"
import { GuardedLink as Link } from "./navigation-guard"
import { LogoutButton } from "./logout-button"
import { useResource } from "@/hooks/use-operation"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

type Access = { tenant?: { id?: string; legalName?: string } }

export function HeaderTools() {
  const access = useResource<Access>("/api/erp/me")
  const company = access.value?.tenant?.legalName?.trim() || "Empresa ativa"
  return <div className="erp-global-actions">
    <Link className="icon-action erp-header-notifications" href="/notificacoes" aria-label="Notificações" title="Notificações"><Bell /></Link>
    <Link className="icon-action" href="/preferencias" aria-label="Preferências" title="Preferências"><Settings /></Link>
    <Link className="erp-company-link" href="/empresas" aria-label="Suas empresas" title={`Empresa ativa: ${company}. Trocar empresa`}><Building2 aria-hidden="true" /><span><small>Empresa</small><strong>{company}</strong></span></Link>
    <DropdownMenu>
      <DropdownMenuTrigger className="icon-action" aria-label="Mais ações"><MoreHorizontal /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 p-1.5">
        <DropdownMenuLabel>Ações do ERP</DropdownMenuLabel>
        <DropdownMenuItem render={<Link href="/assistente" />}><Sparkles />Assistente</DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/aplicativos" />}><LayoutGrid />Aplicativos</DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/ajuda" />}><CircleHelp />Ajuda</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <LogoutButton label="" className="icon-action" />
  </div>
}
