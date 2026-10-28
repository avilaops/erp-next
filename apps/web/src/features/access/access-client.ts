"use client"

export type Access = { tenant: { id: string; legalName: string }; permissions: string[] }
export type Role = { id: string; code: string; name: string; description: string; revision: number; permissions: string[] }
export type User = { id: string; name: string; email: string; status: string; roles: string[] }
export type Member = Omit<User, "roles"> & { revision: number; roleIds: string[] }
export type Invitation = { id: string; name: string; email: string; status: "pending" | "expired" | "accepted" | "revoked"; delivery: "sending" | "sent" | "failed" | "unknown" | "limited"; expiresAt: string; roles: string[] }
export type Invitations = { data: Invitation[]; enabled: boolean }
export const invitationStatus = (status: Invitation["status"]) => ({ pending: "Aguardando primeiro acesso", expired: "Expirado", accepted: "Aceito", revoked: "Cancelado" })[status]
export const invitationDelivery = (delivery: Invitation["delivery"]) => ({ sending: "Envio ainda não confirmado. Confira a caixa de entrada antes de reenviar.", sent: "E-mail enviado pelo Auth.", failed: "O Auth não enviou o e-mail. Tente reenviar o convite.", unknown: "Não foi possível confirmar o envio. Confira a caixa de entrada antes de reenviar.", limited: "Limite de envio atingido. Aguarde antes de tentar novamente." })[delivery]
export type Permission = { code: string; description: string }
export type Snapshot<T> = { data: T; etag: string }

export class AccessProblem extends Error {
  constructor(public status: number, title: string) { super(title) }
}

export async function read<T>(resource: string, signal?: AbortSignal): Promise<Snapshot<T>> {
  const response = await fetch(`/api/erp/${resource}`, { cache: "no-store", signal })
  const data = await response.json()
  if (!response.ok) throw new AccessProblem(response.status, data.title || "Não foi possível consultar os acessos")
  return { data, etag: response.headers.get("etag") || "" }
}

export async function write<T>(resource: string, method: string, tenant: string, body?: object, etag?: string, commandKey?: string): Promise<Snapshot<T>> {
  let response: Response
  try {
    response = await fetch(`/api/erp/${resource}`, {
      method, headers: { "Content-Type": "application/json", "X-Tenant-Id": tenant, ...(etag ? { "If-Match": etag } : {}), ...(commandKey ? { "Idempotency-Key": commandKey } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch { throw new AccessProblem(0, "Não foi possível confirmar a gravação. Sua edição foi preservada; confira o servidor antes de continuar") }
  const data = response.status === 204 ? null : await response.json()
  if (!response.ok) throw new AccessProblem(response.status, data.title || "Não foi possível alterar o acesso")
  return { data, etag: response.headers.get("etag") || "" }
}

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Serviço indisponível"
export const statusLabel = (status: string) => ({ active: "Ativo", blocked: "Bloqueado", pending: "Pendente" })[status] || status
