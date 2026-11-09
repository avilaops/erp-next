const prefixes: Record<string, string> = { RO: "11", AC: "12", AM: "13", RR: "14", PA: "15", AP: "16", TO: "17", MA: "21", PI: "22", CE: "23", RN: "24", PB: "25", PE: "26", AL: "27", SE: "28", BA: "29", MG: "31", ES: "32", RJ: "33", SP: "35", PR: "41", SC: "42", RS: "43", MS: "50", MT: "51", GO: "52", DF: "53" }
export const validMunicipalityCode = (code: unknown, state: string): code is string => typeof code === "string" && /^\d{7}$/.test(code) && !!prefixes[state.toUpperCase()] && code.startsWith(prefixes[state.toUpperCase()])
const digits = (value: string) => value.replace(/\D/g, "")
const city = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toUpperCase()
type RecipientAddress = { taxId: string; postalCode: string; state: string; cityName?: string | null; municipalityCode: string; street?: string; number?: string; district?: string; complement?: string | null }
export function applyMunicipalityCode<T extends RecipientAddress>(current: T, expected: RecipientAddress, code: string): T {
  const fields = ["taxId", "postalCode", "state", "cityName", "street", "number", "district", "complement"] as const
  if (current.municipalityCode.trim() || !validMunicipalityCode(code, current.state) || fields.some(field => current[field] !== expected[field])) return current
  return { ...current, municipalityCode: code }
}
export function municipalityMatchesAddress(fields: Record<string, string>, address: { state: string; city: string; postalCode: string }) {
  return validMunicipalityCode(fields.municipalityCode, address.state) && fields.state?.toUpperCase() === address.state.toUpperCase() && !!address.city.trim() && city(fields.city || "") === city(address.city) && (!fields.postalCode || digits(fields.postalCode) === digits(address.postalCode))
}
export async function lookupMunicipalityCode(recipient: RecipientAddress, tenant: string, signal: AbortSignal, fetcher: (url: string, init?: RequestInit) => Promise<Response>): Promise<string | null> {
  if (recipient.municipalityCode.trim() || !/^\d{8}$/.test(digits(recipient.postalCode)) || !prefixes[recipient.state.toUpperCase()] || !recipient.cityName?.trim()) return null
  const response = await fetcher("/api/erp/registry-lookups", { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": tenant }, body: JSON.stringify({ kind: "cep", context: "party", value: digits(recipient.postalCode) }), signal })
  if (!response.ok || signal.aborted) return null
  const reply = await response.json()
  const valid = () => !signal.aborted && reply.tenantId === tenant && reply.kind === "cep" && typeof reply.value === "string" && /^\d{8}$/.test(reply.value) && reply.value === digits(recipient.postalCode) && reply.status === "found" && Number.isFinite(Date.parse(reply.expiresAt)) && Date.parse(reply.expiresAt) > Date.now() && reply.data?.fields && municipalityMatchesAddress(reply.data.fields, { state: recipient.state, city: recipient.cityName!, postalCode: recipient.postalCode })
  if (!valid()) return null
  // A different tab may have changed the shared session cookie during the lookup.
  const sessionResponse = await fetcher("/api/erp/me", { signal })
  if (!sessionResponse.ok) return null
  const session = await sessionResponse.json()
  return session.tenant?.id === tenant && valid() ? reply.data.fields.municipalityCode : null
}
