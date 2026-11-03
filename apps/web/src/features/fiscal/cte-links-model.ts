import type { Schema } from "@/lib/api/types"
import type { CteInspectionView } from "./cte-inspection-model"

export type CteLinks = Schema<"CteCommercialLinks">
export type CteOptions = Schema<"CteCommercialOptions">
export type CteLinkInput = Schema<"CteLinkInput">
export type CteLinkKind = "purchase" | "sale"
export function cteActorHeader(subject: string): string {
  return btoa(Array.from(new TextEncoder().encode(subject), byte => String.fromCharCode(byte)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const cents = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9][0-9]{0,14})$/.test(v)
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0
const text = (v: unknown, max: number): v is string => typeof v === "string" && !!v.trim() && [...v].length <= max
const iso = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v))
const kind = (v: unknown): v is CteLinkKind => v === "purchase" || v === "sale"
const domainRead = (value: CteLinkKind) => value === "purchase" ? "purchasing.orders.read" : "sales.orders.read"
const failure = () => new Error("Os vínculos não correspondem à conferência ou ao acesso atual. Atualize os vínculos")
const canLink = (permissions: readonly string[], value: CteLinkKind) => ["fiscal.cte.read", "fiscal.cte.link", "catalog.parties.read", domainRead(value)].every(p => permissions.includes(p))

function context(value: Record<string, unknown>, inspected: CteInspectionView) {
  if (!inspected.data || value.tenantId !== inspected.tenantId || value.documentId !== inspected.documentId || value.sourceXmlSha256 !== inspected.sourceXmlSha256) throw failure()
  return inspected.data
}

export function parseCteLinks(value: unknown, inspected: CteInspectionView, permissions: readonly string[]): CteLinks {
  if (!record(value) || !permissions.includes("fiscal.cte.read")) throw failure()
  const inspection = context(value, inspected), facts = inspection.document
  const carrier = value.carrier
  if (value.inspectionId !== inspection.id || !integer(value.revision) || value.serviceCents !== facts.serviceCents || !cents(value.serviceCents) || !cents(value.allocatedCents)
    || BigInt(value.allocatedCents) > BigInt(value.serviceCents) || typeof value.canLinkPurchase !== "boolean" || typeof value.canLinkSale !== "boolean"
    || value.canLinkPurchase && !canLink(permissions, "purchase") || value.canLinkSale && !canLink(permissions, "sale")
    || !record(carrier) || carrier.taxId !== facts.carrier.value || !text(carrier.name, 200) || typeof carrier.available !== "boolean"
    || carrier.ownCompany !== (facts.carrier.value === facts.companyTaxId) || !(carrier.partyId === null || uuid(carrier.partyId))
    || carrier.ownCompany && carrier.partyId !== null || !carrier.ownCompany && carrier.available && !uuid(carrier.partyId)
    || !carrier.available && carrier.partyId !== null || carrier.available && !permissions.includes("catalog.parties.read")
    || !Array.isArray(value.data) || value.data.length > 50) throw failure()
  const ids = new Set<string>(), orders = new Set<string>()
  let allocated = BigInt(0)
  for (const row of value.data) {
    if (!record(row) || !uuid(row.id) || ids.has(row.id) || !kind(row.kind) || !cents(row.freightCents) || typeof row.restricted !== "boolean" || typeof row.canUnlink !== "boolean"
      || !(row.carrierPartyId === null || uuid(row.carrierPartyId)) || row.carrierPartyId !== null && !permissions.includes("catalog.parties.read")
      || row.carrierTaxId !== facts.carrier.value || !text(row.carrierName, 200) || !iso(row.createdAt)) throw failure()
    ids.add(row.id); allocated += BigInt(row.freightCents)
    if (row.restricted) {
      if (row.canUnlink || !["orderId", "counterpartyName", "orderAmountCents", "orderRevision", "reason"].every(field => row[field] === null)) throw failure()
    } else {
      if (!permissions.includes(domainRead(row.kind)) || !uuid(row.orderId) || !text(row.counterpartyName, 200) || !cents(row.orderAmountCents) || row.orderAmountCents === "0"
        || !integer(row.orderRevision) || !text(row.reason, 500) || row.canUnlink && !canLink(permissions, row.kind)) throw failure()
      const order = `${row.kind}:${row.orderId}`
      if (orders.has(order)) throw failure()
      orders.add(order)
    }
  }
  if (allocated.toString() !== value.allocatedCents) throw failure()
  return value as CteLinks
}

export function parseCteOptions(value: unknown, inspected: CteInspectionView, expected: CteLinkKind, offset: number): CteOptions {
  if (!record(value)) throw failure()
  context(value, inspected)
  if (value.kind !== expected || value.offset !== offset || !integer(value.limit) || value.limit > 50 || typeof value.total !== "number" || !Number.isSafeInteger(value.total) || value.total < 0
    || !Array.isArray(value.data) || value.data.length > value.limit || value.data.length > Math.max(0, value.total - offset)) throw failure()
  const ids = new Set<string>(), statuses = expected === "purchase" ? ["confirmed", "partially_received", "received", "closed"] : ["confirmed", "completed"]
  for (const row of value.data) {
    if (!record(row) || !uuid(row.id) || ids.has(row.id) || !text(row.counterpartyName, 200) || typeof row.counterpartyTaxId !== "string" || !/^(?:[0-9]{11}|[0-9A-Z]{12}[0-9]{2})$/.test(row.counterpartyTaxId)
      || !cents(row.amountCents) || row.amountCents === "0" || !integer(row.revision) || typeof row.status !== "string" || !statuses.includes(row.status)
      || typeof row.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.dueDate) || !Number.isFinite(Date.parse(row.dueDate)) || new Date(row.dueDate).toISOString().slice(0, 10) !== row.dueDate) throw failure()
    ids.add(row.id)
  }
  return value as CteOptions
}

export function cteFreightCents(value: unknown): string {
  if (typeof value !== "string") throw new Error("Informe o frete em reais, como 150,01")
  const match = /^(0|[1-9][0-9]{0,12})(?:[,.]([0-9]{1,2}))?$/.exec(value.trim())
  if (!match) throw new Error("Informe o frete em reais, sem sinal ou separador de milhar, como 150,01")
  return (BigInt(match[1]) * BigInt(100) + BigInt((match[2] || "").padEnd(2, "0"))).toString()
}

export function cteLinkReason(value: string): string {
  const reason = value.trim()
  if ([...reason].length < 3 || [...reason].length > 500 || /[\u0000-\u001f\u007f-\u009f]/.test(reason)) throw new Error("Descreva a conferência em 3 a 500 caracteres, sem quebras de linha")
  return reason
}
export function buildCteLinkInput(value: CteLinkKind, orderId: string, carrierPartyId: string | null, amount: string, reason: string, reviewed: boolean): CteLinkInput {
  if (!kind(value) || !uuid(orderId) || !(carrierPartyId === null || uuid(carrierPartyId)) || reviewed !== true) throw new Error("Selecione um pedido e confirme a conferência da transportadora e do pedido")
  return { kind: value, orderId, carrierPartyId, freightCents: cteFreightCents(amount), reason: cteLinkReason(reason) }
}
