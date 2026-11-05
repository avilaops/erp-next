import assert from "node:assert/strict";
import { test } from "node:test";
import { hundredths, discountFromEntry, parseSimulation } from "../src/features/commercial-settings/simulator-model.ts";

test("commercial amounts preserve decimal cents and reject ambiguous or lossy values", () => {
  for (const [raw, expected] of [["0,01", 1], ["226.00", 22600], [" 15,9 ", 1590]]) assert.equal(hundredths(raw), expected);
  for (const raw of ["", "-1", "1e3", "1.000,00", "0,001", "Infinity"]) assert.equal(hundredths(raw), null);
  assert.deepEqual(discountFromEntry("percent", "20,25"), { kind: "percent", value: 2025 });
  assert.equal(discountFromEntry("percent", "100"), null);
  assert.equal(discountFromEntry("target", "0"), null);
});

test("quote validation rejects stale conditions, foreign tenants and inconsistent money", () => {
  const input = { versionId: "v", productId: "p", quantity: 2, destination: "SP", taxpayer: false, discount: { kind: "percent", value: 0 }, freightCents: 0 };
  const value = { tenantId: "tenant", line: "imported", versionId: "v", version: 1, digest: "a".repeat(64), input, product: { name: "Equipamento", sku: "SKU", unit: "UN" }, sale: { quantity: 2, tableUnitCents: 100, tableTotalCents: 200, discountCents: 0, discountBps: 0, unitWithoutIpiCents: 100, unitWithIpiCents: 113, netSaleCents: 200, ipiCents: 26, ipiBps: 1300, invoiceTotalCents: 226, minimumDownPaymentBps: 7000, minimumDownPaymentCents: 158, freeDiscountBps: 2000, freightCents: 0, band: "at_target", needsApproval: false, approvalReasons: [] } };
  assert.deepEqual(parseSimulation(value, "tenant", "imported", input), value);
  for (const modify of [
    v => { v.tenantId = "foreign"; }, v => { v.line = "national"; }, v => { v.versionId = "other"; },
    v => { v.input.quantity = 3; }, v => { v.input.taxpayer = true; }, v => { v.input.discount.value = 20; },
    v => { v.sale.invoiceTotalCents = 227; }, v => { v.sale.ipiCents = 27; }, v => { v.sale.band = "unknown"; },
    v => { v.sale.unitWithIpiCents = NaN; }, v => { v.digest = "invalid"; },
  ]) { const changed = structuredClone(value); modify(changed); assert.throws(() => parseSimulation(changed, "tenant", "imported", input)); }
});
