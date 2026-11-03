import type { Schema } from "@/lib/api/types"
import type { CteDocument } from "./cte-documents"

export type CteInspectionView = {
  tenantId: string; documentId: string; sourceXmlSha256: string; canInspect: boolean
  data: Schema<"CteInspectionSnapshot"> | null
}
type Selected = Pick<CteDocument, "id" | "companyTaxId" | "xmlSha256">
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const iso = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
const cents = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]{0,14})$/.test(value)
const nfeKey = /^[0-9]{6}[0-9A-Z]{12}[0-9]{2}55[0-9]{22}$/
const cteKey = /^[0-9]{6}[0-9A-Z]{12}[0-9]{2}(?:57|67)[0-9]{22}$/
const roleNames = ["carrier", "sender", "dispatcher", "receiver", "recipient", "taker", "authorized_xml"]
const takerRoles = ["sender", "dispatcher", "receiver", "recipient", "other"]
const fail = () => new Error("A conferência não corresponde ao arquivo ou à empresa selecionada. Atualize os arquivos")

export type CteAccess = { id: string; legalName: string; subject: string }
export function parseCteAccess(value: unknown, expected?: Pick<CteAccess, "id" | "subject">): CteAccess {
  if (!record(value) || !record(value.tenant) || typeof value.tenant.id !== "string" || !uuid.test(value.tenant.id) || typeof value.tenant.legalName !== "string"
    || !record(value.identity) || typeof value.identity.subject !== "string" || !value.identity.subject.trim()) throw new Error("Entre e selecione uma empresa antes de consultar CT-e")
  if (!Array.isArray(value.permissions) || !value.permissions.includes("fiscal.cte.read")) throw new Error("Sem permissão atual para consultar CT-e. Atualize os arquivos")
  if (expected && value.tenant.id !== expected.id) throw new Error("A empresa da sessão mudou. Atualize os arquivos antes de continuar")
  if (expected && value.identity.subject !== expected.subject) throw new Error("O usuário da sessão mudou. Atualize os arquivos antes de continuar")
  return { id: value.tenant.id, legalName: value.tenant.legalName, subject: value.identity.subject }
}

function party(value: unknown): value is Record<string, unknown> {
  return record(value) && (value.kind === "CNPJ" && typeof value.value === "string" && /^[0-9A-Z]{12}[0-9]{2}$/.test(value.value)
    || value.kind === "CPF" && typeof value.value === "string" && /^[0-9]{11}$/.test(value.value))
    && (value.name === null || typeof value.name === "string" && value.name.length <= 60)
}
function references(value: unknown, pattern: RegExp): value is string[] {
  return Array.isArray(value) && value.length <= 2000 && value.every(key => typeof key === "string" && pattern.test(key)) && new Set(value).size === value.length
}

/** UI boundary only: context/type checks do not replace the backend's XML inspection. */
export function parseCteInspection(value: unknown, selected: Selected, tenantId: string): CteInspectionView {
  if (!record(value) || value.tenantId !== tenantId || value.documentId !== selected.id || value.sourceXmlSha256 !== selected.xmlSha256 || typeof value.canInspect !== "boolean") throw fail()
  if (value.data === null) return value as CteInspectionView
  const snapshot = value.data
  if (!record(snapshot) || typeof snapshot.id !== "string" || !uuid.test(snapshot.id) || snapshot.documentId !== selected.id || snapshot.sourceXmlSha256 !== selected.xmlSha256 || snapshot.inspectorVersion !== "cte-received-v1" || !iso(snapshot.createdAt)) throw fail()
  const data = snapshot.document
  if (!record(data) || data.source !== "cte_distribution" || data.schemaVersion !== "4.00" || data.profile !== "PL_CTe_400_NT2026.004_RTC_1.00_2026-10-16"
    || data.environment !== "homologation" || data.companyTaxId !== selected.companyTaxId || data.xmlSha256 !== selected.xmlSha256
    || typeof data.accessKey !== "string" || !cteKey.test(data.accessKey) || data.accessKey.slice(20, 22) !== "57"
    || typeof data.number !== "string" || !/^[1-9][0-9]{0,8}$/.test(data.number) || typeof data.series !== "string" || !/^[0-9]{1,3}$/.test(data.series) || !iso(data.issuedAt)
    || typeof data.modal !== "string" || !["01", "02", "03", "04", "05", "06"].includes(data.modal)
    || typeof data.documentType !== "string" || !["0", "1", "3"].includes(data.documentType)
    || !party(data.carrier) || !party(data.taker) || typeof data.takerRole !== "string" || !takerRoles.includes(data.takerRole)
    || !["sender", "dispatcher", "receiver", "recipient"].every(role => data[role] === null || party(data[role]))
    || !cents(data.serviceCents) || !cents(data.receivableCents) || !references(data.nfeReferences, nfeKey) || !references(data.cteReferences, cteKey) || data.cteReferences.includes(data.accessKey)) throw fail()
  if (data.takerRole !== "other") {
    const participant = data[data.takerRole]
    if (!record(participant) || participant.kind !== data.taker.kind || participant.value !== data.taker.value || participant.name !== data.taker.name) throw fail()
  }
  const roles = data.companyRoles
  if (!Array.isArray(roles) || !roles.length || roles.length > roleNames.length || !roles.every(role => typeof role === "string" && roleNames.includes(role)) || new Set(roles).size !== roles.length) throw fail()
  const expectedRoles = roleNames.filter(role => {
    const person = data[role]
    return record(person) && person.kind === "CNPJ" && person.value === selected.companyTaxId
  })
  const declaredRoles = roles.filter(role => role !== "authorized_xml")
  if (declaredRoles.length !== expectedRoles.length || declaredRoles.some((role, index) => role !== expectedRoles[index])) throw fail()
  const verification = data.verification, protocol = data.protocol
  if (!record(verification) || verification.layout !== "official_schema_valid" || verification.signature !== "consistent" || verification.certificateTrust !== "not_verified" || verification.currentStatus !== "not_queried" || verification.protocolAuthenticity !== "not_verified"
    || !record(protocol) || typeof protocol.code !== "string" || !/^[0-9]{3,4}$/.test(protocol.code) || typeof protocol.number !== "string" || !/^[0-9]{15}$/.test(protocol.number)
    || !iso(protocol.receivedAt) || typeof protocol.digest !== "string" || !/^[A-Za-z0-9+/]{27}=$/.test(protocol.digest)) throw fail()
  return value as CteInspectionView
}

export function formatCteMoney(value: unknown): string {
  if (!cents(value)) throw new Error("Valor CT-e inválido")
  const total = BigInt(value), whole = total / BigInt(100), fraction = (total % BigInt(100)).toString().padStart(2, "0")
  return `R$ ${whole.toLocaleString("pt-BR")},${fraction}`
}
