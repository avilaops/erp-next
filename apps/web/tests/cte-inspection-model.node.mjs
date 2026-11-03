import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as model from "../src/features/fiscal/cte-inspection-model.ts";
const { parseCteInspection, formatCteMoney } = model;

const facts = JSON.parse(readFileSync(new URL("../../api/src/http/fixtures/cte-received-inspection.json", import.meta.url), "utf8"));
const tenant = "11111111-1111-4111-8111-111111111111";
const selected = { id: "22222222-2222-4222-8222-222222222222", xmlSha256: facts.xmlSha256, companyTaxId: facts.companyTaxId };
const reply = () => ({ tenantId: tenant, documentId: selected.id, sourceXmlSha256: selected.xmlSha256, canInspect: true, data: { id: "44444444-4444-4444-8444-444444444444", documentId: selected.id, sourceXmlSha256: selected.xmlSha256, inspectorVersion: "cte-received-v1", document: structuredClone(facts), createdAt: "2026-11-03T15:00:00Z" } });

test("CT-e current access rejects revoked read permission and a different actor in the same tenant", () => {
  const current = { tenant: { id: tenant, legalName: "Empresa sintética" }, identity: { subject: "actor-a" }, permissions: ["fiscal.cte.read"] };
  const expected = { id: tenant, subject: "actor-a" };
  assert.equal(model.parseCteAccess(current, expected).subject, "actor-a");
  assert.deepEqual(model.parseCteAccess(current, expected).permissions, ["fiscal.cte.read"]);
  assert.throws(() => model.parseCteAccess(current, { ...expected, permissions: ["fiscal.cte.read", "sales.orders.read"] }));
  for (const change of [
    value => { value.permissions = []; },
    value => { value.permissions = ["fiscal.cte.inspect"]; },
    value => { value.permissions = ["fiscal.cte.read", 1]; },
    value => { value.identity.subject = "actor-b"; },
    value => { value.tenant.id = selected.id; },
    value => { delete value.identity; },
  ]) { const value = structuredClone(current); change(value); assert.throws(() => model.parseCteAccess(value, expected)); }
});

test("CT-e inspection view binds facts and empty states to selected tenant, document and hash", () => {
  assert.deepEqual(parseCteInspection(reply(), selected, tenant), reply());
  const pending = { ...reply(), data: null };
  assert.deepEqual(parseCteInspection(pending, selected, tenant), pending);
  for (const change of [
    value => { value.tenantId = selected.id; },
    value => { value.documentId = tenant; },
    value => { value.sourceXmlSha256 = "0".repeat(64); },
    value => { value.data.documentId = tenant; },
    value => { value.data.sourceXmlSha256 = "0".repeat(64); },
    value => { value.data.document.xmlSha256 = "0".repeat(64); },
    value => { value.data.document.companyTaxId = "11222333000181"; },
  ]) { const value = reply(); change(value); assert.throws(() => parseCteInspection(value, selected, tenant)); }
});

test("CT-e inspection view rejects coercion, unsupported profiles and stronger verification claims", () => {
  for (const change of [
    value => { value.canInspect = "true"; },
    value => { value.data.inspectorVersion = "unknown"; },
    value => { value.data.document.profile = "unknown"; },
    value => { value.data.document.environment = ["homologation"]; },
    value => { value.data.document.carrier.kind = ["CNPJ"]; },
    value => { value.data.document.carrier.name = ["name"]; },
    value => { value.data.document.companyRoles = [["sender"]]; },
    value => { value.data.document.companyRoles = ["carrier"]; },
    value => { value.data.document.takerRole = "unknown"; },
    value => { value.data.document.takerRole = "recipient"; },
    value => { value.data.document.serviceCents = 15001; },
    value => { value.data.document.nfeReferences = [[facts.nfeReferences[0]]]; },
    value => { value.data.document.cteReferences = [facts.accessKey]; },
    value => { value.data.document.verification.certificateTrust = "verified"; },
    value => { value.data.document.verification.currentStatus = "authorized"; },
    value => { value.data.document.protocol.code = ["100"]; },
  ]) { const value = reply(); change(value); assert.throws(() => parseCteInspection(value, selected, tenant)); }
});

test("CT-e money formatting preserves zero and all schema digits without floating point", () => {
  assert.equal(formatCteMoney("0"), "R$ 0,00");
  assert.equal(formatCteMoney("1"), "R$ 0,01");
  assert.equal(formatCteMoney("15001"), "R$ 150,01");
  assert.equal(formatCteMoney("999999999999999"), "R$ 9.999.999.999.999,99");
  for (const value of ["", "01", "-1", "1.00", "1e2", "9999999999999999", 15001, null]) assert.throws(() => formatCteMoney(value));
});

test("CT-e inspection displays all three and four digit protocol codes allowed by the pinned TStat schema", () => {
  for (const code of ["100", "999", "1000", "9999"]) {
    const value = reply(); value.data.document.protocol.code = code;
    assert.equal(parseCteInspection(value, selected, tenant).data.document.protocol.code, code);
  }
  for (const code of ["10", "10000", "1e3", 1000]) {
    const value = reply(); value.data.document.protocol.code = code;
    assert.throws(() => parseCteInspection(value, selected, tenant));
  }
});
