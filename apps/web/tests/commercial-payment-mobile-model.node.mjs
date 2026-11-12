import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCheckout, paymentPlanReadiness } from "../src/features/sales/commercial-payment-mobile-model.ts";

const method = { id: "pix", name: "PIX", kind: "pix" };
const draft = (changes = {}) => ({
  orderMode: true, methods: [method], totalCents: 10000, entryCents: 3000,
  invalidPercent: false, entryMethod: "pix", entryDate: "", balanceMethod: "pix",
  rows: [{ key: "one", paymentMethodId: "pix", dueOn: "2026-12-12", amount: "70,00" }],
  manufacturing: "45", manufacturingUnit: "business", registration: "ISENTO",
  deliveryNotes: "Portão lateral.", deliveryMethodNote: "Retirada na fábrica.",
  paymentNotes: "", notes: "", ...changes,
});

test("checkout reports every invalid installment field and delivery issue in save order", () => {
  const result = validateCheckout(draft({ entryMethod: "", manufacturing: "", rows: [
    { key: "one", paymentMethodId: "", dueOn: "2026-02-30", amount: "0" },
    { key: "two", paymentMethodId: "missing", dueOn: "", amount: "invalid" },
  ] }));
  assert.deepEqual(result.issues.map(issue => issue.field), [
    "checkout.entry-method", "checkout.date-one", "checkout.amount-one", "checkout.method-one",
    "checkout.date-two", "checkout.amount-two", "checkout.method-two", "checkout.manufacturing",
  ]);
  assert.equal(result.value, null);
  assert.equal(result.issues.at(-1).section, "delivery");
});

test("missing balance method and generation are separately actionable", () => {
  assert.deepEqual(validateCheckout(draft({ balanceMethod: "", rows: [] })).issues.map(issue => issue.field), ["checkout.balance-method", "checkout.generate"]);
});

test("invalid entry percentage reports its allowed range consistently in both checkout modes", () => {
  for (const orderMode of [true, false]) {
    const result = validateCheckout(draft({ orderMode, invalidPercent: true }));
    assert.deepEqual(result.issues, [{ field: "checkout.entry-percent", section: "payment", message: "A entrada deve estar entre 0% e 100%." }]);
    assert.equal(result.value, null);
  }
});

test("invalid raw entry remains actionable while negotiation has no priced result", () => {
  const input = draft({ totalCents: null, entryCents: null, entryRaw: "abc", rows: [] });
  const snapshot = structuredClone(input);
  const result = validateCheckout(input);
  assert.equal(result.issues[0].field, "checkout.entry");
  assert.match(result.issues[0].message, /valor válido.*entrada/i);
  assert.equal(result.value, null);
  assert.deepEqual(input, snapshot);
});

test("entry above total explains the invalid amount instead of requesting a simulation", () => {
  const result = validateCheckout(draft({ entryCents: 20000, entryRaw: "200,00", rows: [] }));
  assert.equal(result.issues[0].field, "checkout.entry");
  assert.match(result.issues[0].message, /entrada.*não pode.*total/i);
  assert.equal(result.value, null);
});

test("validated checkout preserves cents and records delivery mode, unit and entry anchor without mutating draft", () => {
  const input = draft({ rows: [
    { key: "one", paymentMethodId: "pix", dueOn: "2026-12-12", amount: "23,34" },
    { key: "two", paymentMethodId: "pix", dueOn: "2027-01-11", amount: "23,33" },
    { key: "three", paymentMethodId: "pix", dueOn: "2027-02-10", amount: "23,33" },
  ] });
  const original = structuredClone(input);
  const result = validateCheckout(input);
  assert.deepEqual(result.issues, []);
  assert.ok(result.value);
  assert.equal(result.value.installments.reduce((sum, row) => sum + row.amountCents, 0), 7000);
  assert.equal(result.value.entry.dueOn, null);
  assert.equal(result.value.deliveryNotes, "Retirada na fábrica.\nPrazo de fabricação: 45 dias úteis. Contado após o pagamento da entrada.\nPortão lateral.");
  assert.deepEqual(input, original);
});

test("delivery length limit includes mode and manufacturing annotation", () => {
  assert.ok(validateCheckout(draft({ deliveryNotes: "x".repeat(1980) })).issues.some(issue => issue.field === "checkout.delivery-notes"));
});

test("unpriced and negative balance cannot generate or add installments", () => {
  for (const balance of [null, -1, 0]) {
    const result = paymentPlanReadiness({ balance, methods: [method], method: "pix", count: "1", firstDays: "30", interval: "30", entryDate: "", dueDate: "", today: "2026-11-12", rows: [] });
    assert.ok(result.generateReason);
    assert.ok(result.addReason);
  }
});

test("single installment ignores hidden interval while generation keeps a concrete first-date anchor", () => {
  const result = paymentPlanReadiness({ balance: 7000, methods: [method], method: "pix", count: "1", firstDays: "30", interval: "invalid", entryDate: "2026-11-12", dueDate: "", today: "2026-11-13", rows: [] });
  assert.equal(result.generateReason, "");
  assert.equal(result.firstDate, "2026-12-12");
  assert.equal(result.intervalDays, 0);
});

test("adding validates existing last date and interval rather than unrelated generation count", () => {
  const result = paymentPlanReadiness({ balance: 7000, methods: [method], method: "pix", count: "invalid", firstDays: "bad", interval: "30", entryDate: "", dueDate: "", today: "2026-11-12", rows: [{ dueOn: "2026-12-12" }] });
  assert.ok(result.generateReason);
  assert.equal(result.addReason, "");
  assert.equal(result.addDate, "2027-01-11");
});

test("full entry can clear an existing installment plan while preventing an added installment", () => {
  const result = paymentPlanReadiness({ balance: 0, methods: [method], method: "", count: "invalid", firstDays: "", interval: "bad", entryDate: "", dueDate: "", today: "2026-11-12", rows: [{ dueOn: "2026-12-12" }] });
  assert.equal(result.generateReason, "");
  assert.ok(result.addReason);
});

test("simulator keeps its existing combined missing balance instruction", () => {
  assert.equal(validateCheckout(draft({ orderMode: false, balanceMethod: "", rows: [] })).issues[0].message, "Escolha a forma do saldo e gere as parcelas antes de criar o pedido.");
});
