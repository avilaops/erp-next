const statuses: Record<string, string> = { "1": "NULA", "2": "ATIVA", "3": "SUSPENSA", "4": "INAPTA", "8": "BAIXADA" }
export const registrationWarningPrefix = "Situação cadastral do CNPJ:"

function plain(value: unknown): string | null {
  return typeof value === "string" && value.trim() && value.length <= 200 && !/[\u0000-\u001f]/.test(value) ? value.trim() : null
}

export function cnpjRegistration(fields: Record<string, unknown> = {}) {
  const rawCode = plain(fields.registrationStatusCode)
  const code = rawCode && /^0?[12348]$/.test(rawCode) ? String(Number(rawCode)) : null
  const reported = plain(fields.registrationStatus)?.toUpperCase()
  const malformedLabel = fields.registrationStatus != null && !reported
  const known = Boolean(code && !malformedLabel && (!reported || reported === statuses[code]))
  const rawDate = plain(fields.registrationStatusDate)
  let date: string | null = null
  if (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    const parsed = new Date(`${rawDate}T00:00:00Z`)
    if (Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === rawDate) date = rawDate.split("-").reverse().join("/")
  }
  return { code: known ? code : null, label: known ? statuses[code!] : "Não confirmada", known, requiresAttention: known && code !== "2", date, reason: plain(fields.registrationStatusReason) }
}
