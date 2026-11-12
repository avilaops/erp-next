import type { Schema } from "@/lib/api/types"
import { municipalityMatchesAddress, validMunicipalityCode } from "../../lib/municipality-code.ts"

export type OrderCustomerParty = Omit<Schema<"PartyInput">, "addresses" | "contacts"> & {
  addresses: (Schema<"PartyAddress"> & { municipalityCode?: string | null })[]
  contacts: Schema<"PartyContact">[]
}
export type OrderCustomerDraft = {
  personType: string; taxId: string; legalName: string; tradeName: string; stateRegistration: string
  responsible: string; phone: string; email: string; postalCode: string; street: string; number: string
  complement: string; district: string; city: string; state: string; municipalityCode: string
}
export type OrderCustomerField = keyof OrderCustomerDraft
export type OrderCustomerIssue = { field: OrderCustomerField; message: string }
export type OrderCustomerCommand = { tenantId: string; id?: string; etag: string; key: string; body: string; input: OrderCustomerParty }
export type OrderCustomerWriteResult =
  | { status: "saved"; id: string; etag: string; party: OrderCustomerParty }
  | { status: "uncertain" | "conflict" | "error"; message: string }

export const normalizeOrderCustomerDocument = (value: string) => value.trim().replace(/[.\s/-]/g, "").toUpperCase()
const optional = (value: string | null | undefined) => value?.trim() || null
const normalizedPhone = (value: string | null | undefined) => {
  const trimmed = optional(value)
  return trimmed && /^[\d\s()+.-]+$/.test(trimmed) ? trimmed.replace(/[\s().-]/g, "") : trimmed
}

// Apply on blur only: incomplete/foreign numbers and invalid manual input stay intact.
export function formatOrderCustomerValue(field: OrderCustomerField, value: string, personType = "juridica") {
  if (field === "taxId" && /^[A-Za-z\d.\s/-]+$/.test(value)) {
    const document = normalizeOrderCustomerDocument(value)
    if (personType === "fisica" && /^\d{11}$/.test(document)) return document.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")
    if (personType === "juridica" && /^[A-Z\d]{12}\d{2}$/.test(document)) return document.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, "$1.$2.$3/$4-$5")
  }
  if (field === "postalCode" && /^[\d. -]+$/.test(value) && value.replace(/\D/g, "").length === 8) return value.replace(/\D/g, "").replace(/^(\d{5})(\d{3})$/, "$1-$2")
  if (field === "phone" && /^[\d\s().-]+$/.test(value)) {
    const digits = value.replace(/\D/g, "")
    if (/^\d{10,11}$/.test(digits)) return digits.replace(/^(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3")
  }
  return value
}
const addressIndex = (party: OrderCustomerParty) => Math.max(0, party.addresses.findIndex(address => address.primary))
const contactIndex = (party: OrderCustomerParty) => Math.max(0, party.contacts.findIndex(contact => contact.primary))
const states = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"]

export function emptyOrderCustomerDraft(): OrderCustomerDraft {
  return { personType: "juridica", taxId: "", legalName: "", tradeName: "", stateRegistration: "", responsible: "", phone: "", email: "", postalCode: "", street: "", number: "", complement: "", district: "", city: "", state: "", municipalityCode: "" }
}

export function orderCustomerDraft(party: OrderCustomerParty): OrderCustomerDraft {
  const address = party.addresses[addressIndex(party)]
  const contact = party.contacts[contactIndex(party)]
  return {
    ...emptyOrderCustomerDraft(), personType: party.personType, taxId: party.taxId, legalName: party.legalName,
    tradeName: party.tradeName || "", responsible: contact?.name || "", phone: party.phone || contact?.phone || "", email: party.email || contact?.email || "",
    postalCode: address?.postalCode || "", street: address?.street || "", number: address?.number || "", complement: address?.complement || "",
    district: address?.district || "", city: address?.city || "", state: address?.state || "", municipalityCode: address?.municipalityCode || "",
  }
}

function normalizedParty(party: OrderCustomerParty): OrderCustomerParty {
  return {
    personType: party.personType, taxId: normalizeOrderCustomerDocument(party.taxId), legalName: party.legalName.trim(), tradeName: optional(party.tradeName),
    email: optional(party.email), phone: optional(party.phone), isCustomer: party.isCustomer, isSupplier: party.isSupplier, status: party.status,
    addresses: party.addresses.map(address => ({ label: address.label.trim(), postalCode: address.postalCode.replace(/\D/g, ""), state: address.state.trim().toUpperCase(), city: address.city.trim(), street: address.street.trim(), number: address.number.trim(), district: address.district.trim(), complement: optional(address.complement), primary: !!address.primary, ...(optional(address.municipalityCode) ? { municipalityCode: address.municipalityCode!.trim() } : {}) })),
    contacts: party.contacts.map(contact => ({ name: contact.name.trim(), role: optional(contact.role), email: optional(contact.email), phone: optional(contact.phone), primary: !!contact.primary })),
  }
}

export function buildOrderCustomerPayload(draft: OrderCustomerDraft, original?: OrderCustomerParty): OrderCustomerParty {
  const baseline = original ? orderCustomerDraft(original) : emptyOrderCustomerDraft()
  const party: OrderCustomerParty = original ? { ...original, addresses: [...original.addresses], contacts: [...original.contacts] } : { personType: "juridica", taxId: "", legalName: "", tradeName: null, email: null, phone: null, isCustomer: true, isSupplier: false, status: "active", addresses: [], contacts: [] }
  party.personType = draft.personType
  party.taxId = draft.taxId
  party.legalName = draft.legalName
  party.tradeName = optional(draft.tradeName)
  if (!original || draft.email !== baseline.email) party.email = optional(draft.email)
  if (!original || normalizedPhone(draft.phone) !== normalizedPhone(baseline.phone)) party.phone = normalizedPhone(draft.phone)
  const selectedAddress = addressIndex(party)
  const previousAddress = party.addresses[selectedAddress]
  // The small editor replaces only the selected primary address, never the rest of the record.
  party.addresses[selectedAddress] = {
    label: previousAddress?.label ?? "Principal", primary: previousAddress?.primary ?? true,
    postalCode: draft.postalCode, state: draft.state, city: draft.city, street: draft.street, number: draft.number,
    district: draft.district, complement: optional(draft.complement), ...(draft.municipalityCode.trim() ? { municipalityCode: draft.municipalityCode.trim() } : {}),
  }
  const selectedContact = contactIndex(party)
  const previousContact = party.contacts[selectedContact]
  if (draft.responsible.trim()) {
    if (!previousContact) party.contacts.push({ name: draft.responsible, role: null, phone: normalizedPhone(draft.phone), email: optional(draft.email), primary: true })
    else party.contacts[selectedContact] = {
      ...previousContact,
      ...(draft.responsible !== baseline.responsible ? { name: draft.responsible } : {}),
      ...(normalizedPhone(draft.phone) !== normalizedPhone(baseline.phone) ? { phone: normalizedPhone(draft.phone) } : {}),
      ...(draft.email !== baseline.email ? { email: optional(draft.email) } : {}),
    }
  } else if (previousContact && draft.responsible !== baseline.responsible) party.contacts.splice(selectedContact, 1)
  return normalizedParty(party)
}

export function orderCustomerPayloadEqual(left: OrderCustomerParty, right: OrderCustomerParty) {
  return JSON.stringify(normalizedParty(left)) === JSON.stringify(normalizedParty(right))
}

function validDocument(value: string, personType: string) {
  if (!/^[A-Za-z0-9.\s/-]+$/.test(value)) return false
  const normalized = normalizeOrderCustomerDocument(value)
  if (/^(.)\1+$/.test(normalized)) return false
  if (personType === "fisica") {
    if (!/^\d{11}$/.test(normalized)) return false
    const digit = (length: number) => String((([...normalized.slice(0, length)].reduce((sum, character, index) => sum + Number(character) * (length + 1 - index), 0) * 10) % 11) % 10)
    return digit(9) === normalized[9] && digit(10) === normalized[10]
  }
  if (personType !== "juridica" || !/^[A-Z\d]{12}\d{2}$/.test(normalized)) return false
  const digit = (base: string) => {
    let weight = base.length - 7
    const sum = [...base].reduce((total, character) => { const next = total + (character.charCodeAt(0) - 48) * weight; weight = weight === 2 ? 9 : weight - 1; return next }, 0)
    return String(sum % 11 < 2 ? 0 : 11 - sum % 11)
  }
  return digit(normalized.slice(0, 12)) === normalized[12] && digit(normalized.slice(0, 13)) === normalized[13]
}

export function orderCustomerIssues(draft: OrderCustomerDraft): OrderCustomerIssue[] {
  const issues: OrderCustomerIssue[] = []
  const add = (field: OrderCustomerField, message: string) => { if (!issues.some(issue => issue.field === field)) issues.push({ field, message }) }
  if (!validDocument(draft.taxId, draft.personType)) add("taxId", `Informe um ${draft.personType === "fisica" ? "CPF" : "CNPJ"} válido.`)
  const required: [OrderCustomerField, string, number][] = [["legalName", draft.personType === "fisica" ? "nome completo" : "razão social", 200], ["responsible", "nome do responsável", 200], ["phone", "celular", 40], ["email", "e-mail", 254], ...(draft.personType === "juridica" ? [["stateRegistration", "inscrição estadual ou ISENTO", 40] as [OrderCustomerField, string, number]] : []), ["postalCode", "CEP", 10], ["street", "endereço", 200], ["number", "número", 40], ["district", "bairro", 200], ["city", "cidade", 200], ["state", "UF", 2]]
  for (const [field, label, maximum] of required) {
    if (!draft[field].trim() || [...draft[field].trim()].length > maximum || /[\u0000-\u001f\u007f]/.test(draft[field])) add(field, `Confira ${label}: preenchimento obrigatório dentro do limite de ${maximum} caracteres.`)
  }
  if (!/^[\d. -]+$/.test(draft.postalCode) || draft.postalCode.replace(/\D/g, "").length !== 8) add("postalCode", "Informe um CEP com oito dígitos.")
  if (!states.includes(draft.state.toUpperCase())) add("state", "Selecione a UF do endereço.")
  if (draft.municipalityCode.trim() && !validMunicipalityCode(draft.municipalityCode, draft.state)) add("city", "O código IBGE não corresponde à UF. Consulte o CEP ou confira cidade e UF.")
  const limits: [OrderCustomerField, number][] = [["tradeName", 200], ["stateRegistration", 40], ["complement", 200]]
  for (const [field, maximum] of limits) if ([...draft[field].trim()].length > maximum || /[\u0000-\u001f\u007f]/.test(draft[field])) add(field, "O campo contém caracteres inválidos ou ultrapassa o limite permitido.")
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim()) || !/^[\x20-\x7e]+$/.test(draft.email.trim())) add("email", "Informe um e-mail válido.")
  return issues
}

export function validateOrderCustomer(draft: OrderCustomerDraft): OrderCustomerIssue | null {
  return orderCustomerIssues(draft)[0] ?? null
}

const lookupFields: OrderCustomerField[] = ["legalName", "tradeName", "phone", "email", "postalCode", "state", "city", "street", "number", "district", "complement", "stateRegistration"]
const addressLookupFields: OrderCustomerField[] = ["postalCode", "state", "city", "street", "number", "district", "complement"]
const normalizedAddressValue = (field: string, value: string) => field === "postalCode" ? value.replace(/\D/g, "") : value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toUpperCase()
export function applyOrderCustomerLookup(current: OrderCustomerDraft, fields: Record<string, string>): OrderCustomerDraft {
  const next = { ...current }
  const sourcePostalCode = typeof fields.postalCode === "string" ? normalizedAddressValue("postalCode", fields.postalCode) : ""
  const addressConflict = !!current.postalCode.trim() && (!sourcePostalCode || normalizedAddressValue("postalCode", current.postalCode) !== sourcePostalCode) || (["state", "city"] as const).some(field => current[field].trim() && typeof fields[field] === "string" && fields[field].trim() && normalizedAddressValue(field, current[field]) !== normalizedAddressValue(field, fields[field]))
  for (const field of lookupFields) {
    if (addressConflict && addressLookupFields.includes(field)) continue
    if (!next[field].trim() && typeof fields[field] === "string" && fields[field].trim()) next[field] = fields[field].trim()
  }
  if (!addressConflict && !next.municipalityCode.trim() && municipalityMatchesAddress(fields, next)) next.municipalityCode = fields.municipalityCode
  return next
}

export function clearOrderCustomerGenerated(current: OrderCustomerDraft, generated: Partial<Record<OrderCustomerField, string>>): OrderCustomerDraft {
  const next = { ...current }
  for (const field of Object.keys(generated) as OrderCustomerField[]) if (next[field] === generated[field]) next[field] = ""
  return next
}

function readConfirmation(value: unknown, etag: string, command: OrderCustomerCommand): Extract<OrderCustomerWriteResult, { status: "saved" }> | null {
  const reply = value as { tenantId?: string; data?: Schema<"Party"> }
  const party = reply?.data
  if (!etag || reply?.tenantId !== command.tenantId || !party?.id || command.id && command.id !== party.id || !Array.isArray(party.addresses) || !Array.isArray(party.contacts) || typeof party.legalName !== "string" || typeof party.taxId !== "string") return null
  return { status: "saved", id: party.id, etag, party: normalizedParty({ ...party, addresses: party.addresses, contacts: party.contacts }) }
}

export async function writeOrderCustomer(command: OrderCustomerCommand, fetcher: (url: string, init?: RequestInit) => Promise<Response>, reconcile = false): Promise<OrderCustomerWriteResult> {
  const uncertain = { status: "uncertain" as const, message: "Não foi possível confirmar o cadastro. Os campos foram preservados; repita a confirmação com o mesmo comando." }
  try {
    const url = command.id ? `/api/erp/parties/${command.id}` : "/api/erp/parties"
    if (reconcile && command.id) {
      const response = await fetcher(url, { cache: "no-store" })
      if (!response.ok) return uncertain
      const current = readConfirmation(await response.json(), response.headers.get("etag") || "", command)
      if (!current) return uncertain
      if (orderCustomerPayloadEqual(current.party, command.input)) return current
      if (current.etag !== command.etag) return { status: "conflict", message: "O cadastro foi alterado no servidor. Sua edição foi preservada. Recarregue o cliente antes de continuar." }
    }
    const response = await fetcher(url, {
      method: command.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", "X-Tenant-Id": command.tenantId, "Idempotency-Key": command.key, ...(command.id ? { "If-Match": command.etag } : {}) },
      body: command.body,
    })
    const value = await response.json()
    if (!response.ok) return { status: reconcile || response.status >= 500 ? "uncertain" : response.status === 412 ? "conflict" : "error", message: typeof value?.title === "string" ? value.title : "Não foi possível salvar o cadastro." }
    return readConfirmation(value, response.headers.get("etag") || "", command) || uncertain
  } catch { return uncertain }
}
