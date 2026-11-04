"use client"

import { useResource } from "@/hooks/use-operation"

/** Display a company name only when it belongs to the record being shown. */
export function RecordCompany({ tenantId }: { tenantId: string }) {
  const access = useResource<{ tenant: { id: string; legalName: string } }>("/api/erp/me")
  const tenant = access.value?.tenant
  if (tenant?.id !== tenantId || !tenant.legalName?.trim()) return null
  return <p className="break-words text-sm text-muted-foreground">Empresa: {tenant.legalName}</p>
}
