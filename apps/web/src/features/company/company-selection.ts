import { safeReturnTo } from "@/lib/return-to"

export class CompanySelectionError extends Error {
  constructor(message: string, readonly status?: number) { super(message) }
}

function selectionError(status: number, title?: unknown) {
  if (status === 401) return "Sua sessão expirou. Entre novamente para continuar."
  if (status === 403) return "Seu acesso a esta empresa não foi autorizado."
  if (status === 503) return "O serviço de empresas está temporariamente indisponível. Tente novamente."
  return typeof title === "string" && title ? title : "Não foi possível selecionar esta empresa. Tente novamente."
}

export async function selectCompany(tenantId: string, destination: string) {
  // The API has its own 8s deadline. Development also needs time to compile the
  // auth route before its handler starts; aborting at 10s can discard its cookie.
  const response = await fetch("/api/auth/company", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId }),
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.timeout(process.env.NODE_ENV === "development" ? 120000 : 20000),
  })
  const value: unknown = await response.json().catch(() => null)
  const result = value && typeof value === "object" ? value as { title?: unknown; tenantId?: unknown } : null
  if (!response.ok) throw new CompanySelectionError(selectionError(response.status, result?.title), response.status)
  if (result?.tenantId !== tenantId) throw new CompanySelectionError("A empresa selecionada não foi confirmada. Atualize a lista e tente novamente.")
  // A document navigation discards the previous tenant's persistent layout,
  // resource hooks and prefetched pages only after the server confirms selection.
  window.location.assign(safeReturnTo(destination))
}
