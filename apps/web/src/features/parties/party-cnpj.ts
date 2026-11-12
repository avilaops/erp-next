import type { Schema } from "@/lib/api/types"
import { municipalityMatchesAddress } from "../../lib/municipality-code.ts"
import type { PartyAddress } from "./party-complements"

export type PartyFiscal = { taxpayerIndicator: "1" | "2" | "9"; stateRegistration: string | null }
export type PartyDraft = Omit<Schema<"PartyInput">, "addresses" | "fiscal"> & { fiscal?: PartyFiscal | null; addresses: PartyAddress[]; contacts: NonNullable<Schema<"PartyInput">["contacts"]> }
const contactFields = ["legalName", "tradeName", "email", "phone"] as const
type ContactField = typeof contactFields[number]
export type PartyCnpjProvenance = { fields: Partial<Record<ContactField, string>>; address: PartyAddress | null }
export const emptyCnpjProvenance = (): PartyCnpjProvenance => ({ fields: {}, address: null })

export function fillPartyCnpj(current: PartyDraft, fields: Record<string, string>, previous: PartyCnpjProvenance) {
  const draft = { ...current }
  const provenance = { fields: { ...previous.fields }, address: previous.address }
  let count = 0
  const value = (field: string, maximum: number) => fields[field]?.trim() && [...fields[field]].length <= maximum ? fields[field] : ""
  for (const field of contactFields) {
    const available = value(field, field === "email" ? 254 : field === "phone" ? 40 : 200)
    if (!draft[field]?.trim() && available) {
      draft[field] = available
      provenance.fields[field] = available
      count++
    }
  }
  const placeholder = draft.addresses.length === 1 && !draft.addresses[0].primary && ["label", "postalCode", "state", "city", "street", "number", "district", "complement"].every(field => !draft.addresses[0][field as keyof Schema<"PartyAddress">])
  if ((!draft.addresses.length || placeholder) && ["postalCode", "state", "city", "street", "number", "district"].some(field => fields[field]?.trim())) {
    const address: PartyAddress = {
      label: "Endereço cadastral", postalCode: fields.postalCode || "", state: fields.state || "",
      city: value("city", 200), street: value("street", 200), number: value("number", 40),
      district: fields.district || "", complement: fields.complement || null, primary: false,
    }
    if (municipalityMatchesAddress(fields, address)) address.municipalityCode = fields.municipalityCode
    draft.addresses = [address]
    provenance.address = address
    count++
  }
  return { draft, provenance, count }
}

export function clearPartyCnpj(current: PartyDraft, provenance: PartyCnpjProvenance): PartyDraft {
  const draft = { ...current }
  for (const field of contactFields) {
    if (provenance.fields[field] !== undefined && draft[field] === provenance.fields[field]) {
      if (field === "legalName") draft.legalName = ""
      else draft[field] = null
    }
  }
  if (provenance.address && JSON.stringify(draft.addresses[0]) === JSON.stringify(provenance.address)) {
    draft.addresses = draft.addresses.slice(1)
  }
  return draft
}
