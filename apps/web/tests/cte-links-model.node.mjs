import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import * as model from "../src/features/fiscal/cte-links-model.ts";
const facts = JSON.parse(readFileSync(new URL("../../api/src/http/fixtures/cte-received-inspection.json", import.meta.url), "utf8"));
const tenant = "11111111-1111-4111-8111-111111111111";
const doc = "22222222-2222-4222-8222-222222222222";
const inspectionId = "44444444-4444-4444-8444-444444444444";
const party = "55555555-5555-4555-8555-555555555555";
const order = "66666666-6666-4666-8666-666666666666";
const linkId = "77777777-7777-4777-8777-777777777777";
const permissions = ["fiscal.cte.read", "fiscal.cte.link", "catalog.parties.read", "purchasing.orders.read", "sales.orders.read"];
const inspected = { tenantId: tenant, documentId: doc, sourceXmlSha256: facts.xmlSha256, canInspect: true, data: { id: inspectionId, documentId: doc, sourceXmlSha256: facts.xmlSha256, inspectorVersion: "cte-received-v1", document: facts, createdAt: "2026-11-03T15:00:00Z" } };
const view = () => ({ tenantId: tenant, documentId: doc, inspectionId, sourceXmlSha256: facts.xmlSha256, revision: 2, serviceCents: "15001", allocatedCents: "15001", canLinkPurchase: true, canLinkSale: true, carrier: { partyId: party, taxId: facts.carrier.value, name: "Transportadora cadastrada", ownCompany: false, available: true }, data: [{ id: linkId, kind: "purchase", orderId: order, carrierPartyId: party, carrierTaxId: facts.carrier.value, carrierName: "Transportadora cadastrada", counterpartyName: "Fornecedor sintético", orderAmountCents: "50000", orderRevision: 1, freightCents: "15001", reason: "Conferi o pedido", createdAt: "2026-11-03T15:00:00Z", canUnlink: true, restricted: false }] });

test("CT-e links bind tenant, source, inspection and exact allocated sum before displaying order details", () => {
  assert.deepEqual(model.parseCteLinks(view(), inspected, permissions), view());
  for (const change of [
    v => { v.tenantId = doc; }, v => { v.documentId = tenant; }, v => { v.inspectionId = doc; },
    v => { v.sourceXmlSha256 = "0".repeat(64); }, v => { v.serviceCents = "15002"; },
    v => { v.allocatedCents = "15000"; }, v => { v.data[0].freightCents = "15002"; },
    v => { v.carrier.taxId = facts.companyTaxId; }, v => { v.carrier.ownCompany = true; },
    v => { v.data.push(structuredClone(v.data[0])); }, v => { v.revision = "2"; },
  ]) { const value = view(); change(value); assert.throws(() => model.parseCteLinks(value, inspected, permissions)); }
});

test("CT-e links reject stale commercial details after permission changes and accept only fully redacted restricted rows", () => {
  const withoutPurchase = permissions.filter(p => p !== "purchasing.orders.read");
  assert.throws(() => model.parseCteLinks(view(), inspected, withoutPurchase));
  const restricted = view(); restricted.canLinkPurchase = false;
  Object.assign(restricted.data[0], { restricted: true, canUnlink: false, orderId: null, counterpartyName: null, orderAmountCents: null, orderRevision: null, reason: null });
  assert.deepEqual(model.parseCteLinks(restricted, inspected, withoutPurchase), restricted);
  for (const field of ["orderId", "counterpartyName", "orderAmountCents", "orderRevision", "reason"]) {
    const leaked = structuredClone(restricted); leaked.data[0][field] = view().data[0][field];
    assert.throws(() => model.parseCteLinks(leaked, inspected, withoutPurchase));
  }
  assert.throws(() => model.parseCteLinks(view(), inspected, permissions.filter(p => p !== "fiscal.cte.link")));
});

test("CT-e freight input preserves cents, requires an explicit amount and never uses floating point", () => {
  for (const [value, want] of [["0", "0"], ["0,01", "1"], ["150,01", "15001"], ["150.01", "15001"], ["150", "15000"], ["9999999999999,99", "999999999999999"]]) {
    assert.equal(model.cteFreightCents(value), want);
  }
  for (const value of ["", "  ", "01", "-1", "1e2", "1.000,00", "0,001", "10000000000000", 1, null]) assert.throws(() => model.cteFreightCents(value));
});

test("CT-e link command requires selected order, explicit review and a meaningful reason", () => {
  const wanted = { kind: "purchase", orderId: order, carrierPartyId: party, freightCents: "15001", reason: "Conferi o pedido" };
  assert.deepEqual(model.buildCteLinkInput("purchase", order, party, "150,01", " Conferi o pedido ", true), wanted);
  for (const args of [
    ["purchase", "", party, "150,01", "Conferi o pedido", true],
    ["purchase", order, party, "", "Conferi o pedido", true],
    ["purchase", order, party, "150,01", " ", true],
    ["purchase", order, party, "150,01", "Conferi o pedido", false],
  ]) assert.throws(() => model.buildCteLinkInput(...args));
});

test("CT-e order options bind selected kind and source, reject drafts and remain paginated", () => {
  const value = { tenantId: tenant, documentId: doc, sourceXmlSha256: facts.xmlSha256, kind: "purchase", data: [{ id: order, counterpartyName: "Fornecedor sintético", counterpartyTaxId: "11222333000181", dueDate: "2026-11-10", amountCents: "50000", status: "confirmed", revision: 1 }], total: 1, offset: 0, limit: 25 };
  assert.deepEqual(model.parseCteOptions(value, inspected, "purchase", 0), value);
  for (const change of [
    v => { v.kind = "sale"; }, v => { v.sourceXmlSha256 = "0".repeat(64); },
    v => { v.data[0].status = "draft"; }, v => { v.limit = 51; }, v => { v.offset = 25; },
    v => { v.data[0].amountCents = 50000; }, v => { v.data[0].dueDate = "2026-02-30"; },
  ]) { const invalid = structuredClone(value); change(invalid); assert.throws(() => model.parseCteOptions(invalid, inspected, "purchase", 0)); }
});
