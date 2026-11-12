import type { PartyDraft, PartyCnpjProvenance } from "./party-cnpj"

export type PartyCommand = { key: string; body: string }
export type StoredPartyDraft = { version: 1; draft: PartyDraft; baseline: string; etag: string; uncertain: boolean; conflict: boolean; command: PartyCommand | null; provenance: PartyCnpjProvenance }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const text = (value: unknown, max: number) => typeof value === "string" && value.length <= max
const optional = (value: unknown, max: number) => value == null || text(value, max)

function address(value: unknown) {
  return object(value) && text(value.label, 80) && text(value.postalCode, 12) && text(value.state, 2) && text(value.city, 200)
    && text(value.street, 200) && text(value.number, 40) && text(value.district, 200) && optional(value.complement, 200)
    && optional(value.municipalityCode, 7) && typeof value.primary === "boolean"
}

function party(value: unknown): value is PartyDraft {
  if (!object(value)) return false
  const fields = ["personType", "legalName", "tradeName", "taxId", "email", "phone", "isCustomer", "isSupplier", "status", "addresses", "contacts", "fiscal"]
  const fiscal = value.fiscal
  return Object.keys(value).every(key => fields.includes(key)) && ["fisica", "juridica"].includes(String(value.personType))
    && text(value.legalName, 200) && optional(value.tradeName, 200) && text(value.taxId, 30) && optional(value.email, 254) && optional(value.phone, 40)
    && typeof value.isCustomer === "boolean" && typeof value.isSupplier === "boolean" && ["active", "archived"].includes(String(value.status))
    && Array.isArray(value.addresses) && value.addresses.length <= 10 && value.addresses.every(address)
    && Array.isArray(value.contacts) && value.contacts.length <= 10 && value.contacts.every(item => object(item) && text(item.name, 200) && optional(item.role, 100) && optional(item.email, 254) && optional(item.phone, 40) && typeof item.primary === "boolean")
    && (fiscal == null || object(fiscal) && Object.keys(fiscal).every(key => ["taxpayerIndicator", "stateRegistration"].includes(key)) && ["1", "2", "9"].includes(String(fiscal.taxpayerIndicator)) && optional(fiscal.stateRegistration, 14))
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
export const samePartyDraft = (left: PartyDraft, right: PartyDraft) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))

export function readPartyDraft(key: string): { value: StoredPartyDraft | null; error: string } {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return { value: null, error: "" }
    if (raw.length > 100_000) throw new Error("Oversized draft")
    const value = JSON.parse(raw) as StoredPartyDraft
    if (value.version !== 1 || !party(value.draft) || !text(value.baseline, 40_000) || !party(JSON.parse(value.baseline))
      || !text(value.etag, 80) || typeof value.uncertain !== "boolean" || typeof value.conflict !== "boolean") throw new Error("Invalid draft")
    if (!object(value.provenance) || !object(value.provenance.fields) || !Object.entries(value.provenance.fields).every(([key, field]) => ["legalName", "tradeName", "email", "phone"].includes(key) && text(field, 254))
      || value.provenance.address !== null && !address(value.provenance.address)) throw new Error("Invalid provenance")
    if (value.command !== null && (!object(value.command) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.command.key)
      || !text(value.command.body, 40_000) || !party(JSON.parse(value.command.body)) || !samePartyDraft(value.draft, JSON.parse(value.command.body)))) throw new Error("Invalid command")
    if (value.uncertain && !value.command) throw new Error("Missing command")
    // JSON loses the address alias used to track later automatic IBGE filling.
    // Restore it only while the saved address still matches the generated one.
    const generated = value.provenance.address
    const current = value.draft.addresses[0]
    if (generated && current && JSON.stringify(canonical(generated)) === JSON.stringify(canonical(current))) value.provenance.address = current
    return { value, error: "" }
  } catch {
    return { value: null, error: "Não foi possível recuperar o rascunho desta aba. Confira se houve gravação antes de descartar a edição." }
  }
}

export function writePartyDraft(key: string, value: StoredPartyDraft | null): boolean {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value))
    else sessionStorage.removeItem(key)
    return true
  } catch { return false }
}

export function recoverPartyDraft(value: StoredPartyDraft | null, server: PartyDraft, etag: string, existing: boolean): { value: StoredPartyDraft | null; confirmed: boolean } {
  if (!value) return { value: null, confirmed: false }
  if (existing && value.conflict && value.command && etag !== value.etag && samePartyDraft(server, JSON.parse(value.command.body))) return { value: null, confirmed: true }
  return { value: { ...value, conflict: value.conflict || existing && etag !== value.etag }, confirmed: false }
}
