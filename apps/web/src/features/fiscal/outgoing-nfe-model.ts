import type { NfeDraft } from "./nfe-draft-model"

export type ListedDraft = NfeDraft & { createdAt?: string }
export type ListedEmission = { id: string; status: string; environment: string; model: number; number: number; series: number; accessKey?: string | null; issuedAt?: string; recipientName?: string; recipientTaxId?: string; amount?: string; result?: { reason?: string; code?: string } }
export type Note = { id: string; status: string; environment: string; model: number; number?: number; series?: number; recipient: string; taxId: string; amount?: string; date?: string; accessKey?: string | null; reason?: string }
export const noteStatus: Record<string, string> = { draft: "Rascunho", preparing: "Processando", prepared: "XML preparado", unknown: "Resultado incerto", authorized: "Autorizada", rejected: "Rejeitada", cancelled: "Cancelada" }

export function mergeNotes(drafts: ListedDraft[], emissions: ListedEmission[]): Note[] {
  const notes = new Map<string, Note>(drafts.map(d => [d.id, { id: d.id, status: "draft", environment: d.input.environment, model: d.input.model, recipient: d.input.recipient.legalName, taxId: d.input.recipient.taxId, amount: d.productsTotal, date: d.createdAt }]))
  for (const e of emissions) {
    const draft = notes.get(e.id)
    notes.set(e.id, { id: e.id, status: e.status, environment: e.environment, model: e.model, number: e.number, series: e.series, recipient: e.recipientName || draft?.recipient || "Destinatário disponível nos detalhes", taxId: e.recipientTaxId || draft?.taxId || "", amount: e.amount || draft?.amount, date: e.issuedAt || draft?.date, accessKey: e.accessKey, reason: e.result?.reason })
  }
  return [...notes.values()].sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.id.localeCompare(a.id))
}

export function filterNotes(notes: Note[], filters: { query: string; status?: string; environment?: string; from?: string; to?: string }) {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
  const query = normalize(filters.query)
  return notes.filter(n => {
    const haystack = normalize(`${n.recipient} ${n.taxId} ${n.id} ${n.number ?? ""} ${n.accessKey || ""}`)
    const digits = query.replace(/\D/g, "")
    const matches = haystack.includes(query) || (digits.length >= 11 && n.taxId.replace(/\D/g, "").includes(digits))
    const day = n.date ? new Date(n.date).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) : ""
    return matches && (!filters.status || n.status === filters.status) && (!filters.environment || n.environment === filters.environment) && (!filters.from || !!day && day >= filters.from) && (!filters.to || !!day && day <= filters.to)
  })
}

export function certificateMessage(status: string | undefined, verified: boolean) {
  if ((status === "active" || status === "expiring") && !verified) return "Há divergência na verificação do A1. Atualize a situação; o certificado consta conectado."
  const labels: Record<string, string> = { active: "A1 conectado e disponível", expiring: "A1 conectado, próximo do vencimento", expired: "Certificado A1 vencido", not_yet_valid: "Certificado A1 ainda não vigente", company_mismatch: "Certificado A1 de outro CNPJ", unavailable: "A1 cadastrado, mas o cofre não disponibilizou a credencial", not_configured: "Nenhum certificado A1 conectado" }
  return status ? labels[status] || "Não foi possível confirmar a situação do A1" : verified ? "A1 conectado e disponível" : "Não foi possível confirmar a disponibilidade do A1. Confira o certificado."
}
