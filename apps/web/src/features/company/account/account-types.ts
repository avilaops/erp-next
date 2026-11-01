export type Plan = { id: string; name: string; monthlyCents: number; dataMegabytes: number; users: number | null; importedOrders: number | null; customQuote: boolean }
export type Subscription = { id: string; planId: string; status: string; details: { checkoutUrl?: string | null; paymentMethod?: string | null; nextPaymentDate?: string | null; startedAt?: string | null; checkedAt?: string | null } }
export type Account = { tenantId: string; canEdit: boolean; providerConfigured: boolean; plans: Plan[]; subscriptions: Subscription[]; activeUsers: number; productPhotoBytes: number }
export const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100)
export const date = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(value)) : "Não informado"
export const statusLabel = (status: string) => ({ creating: "Aguardando confirmação", pending: "Aguardando autorização", authorized: "Autorizada", paused: "Pausada", cancelled: "Cancelada", rejected: "Não contratada" }[status] || "Situação não reconhecida")
export function safeCheckout(raw?: string | null) {
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === "https:" && url.hostname === "www.mercadopago.com.br" && !url.username && !url.password && !url.port && url.pathname === "/subscriptions/checkout" ? url.href : null
  } catch { return null }
}
