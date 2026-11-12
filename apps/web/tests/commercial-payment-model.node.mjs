import assert from "node:assert/strict";
import { test } from "node:test";
import { installmentPlan, entryFromPercent, entryPercent, addPaymentDays } from "../src/features/sales/commercial-payment-model.ts";
import * as payment from "../src/features/sales/commercial-payment-model.ts";

test("próxima parcela avança o intervalo, preserva zero e valida o calendário", () => {
  assert.equal(typeof payment.nextInstallmentDate, "function");
  assert.equal(payment.nextInstallmentDate("2027-02-28", "30"), "2027-03-30");
  assert.equal(payment.nextInstallmentDate("2028-02-28", "1"), "2028-02-29");
  assert.equal(payment.nextInstallmentDate("2027-02-28", "0"), "2027-02-28");
  for (const interval of ["", "-1", "1.5", "3651", "NaN"]) assert.throws(() => payment.nextInstallmentDate("2027-02-28", interval));
  assert.throws(() => payment.nextInstallmentDate("2027-02-30", "30"));
});

test("parcelas distribuem centavos sem alterar o saldo e atravessam meses pelo calendário", () => {
  const rows = installmentPlan(10000, 3, "2026-12-30", 30, "method");
  assert.deepEqual(rows.map(row => row.amountCents), [3334, 3333, 3333]);
  assert.deepEqual(rows.map(row => row.dueOn), ["2026-12-30", "2027-01-29", "2027-02-28"]);
  assert.equal(rows.reduce((sum, row) => sum + row.amountCents, 0), 10000);
  assert.ok(rows.every(row => row.paymentMethodId === "method"));
  assert.equal(addPaymentDays("2028-02-28", 1), "2028-02-29");
});

test("entrada em percentual corresponde aos centavos negociados sem cálculo monetário fracionário", () => {
  assert.equal(entryFromPercent(2170121, "70"), 1519085);
  assert.equal(entryPercent(1519085, 2170121), "70,00");
  assert.equal(entryFromPercent(333, "50"), 167);
  assert.equal(entryFromPercent(12345, "100"), 12345);
  assert.equal(entryFromPercent(12345, "0"), 0);
});

test("plano rejeita parcelas zero, números fora do limite e datas inexistentes", () => {
  for (const args of [[1, 2, "2026-12-30", 30], [100, 121, "2026-12-30", 30], [100, 0, "2026-12-30", 30], [100, 2, "2026-02-30", 30], [100, 2, "2026-12-30", -1]]) {
    assert.throws(() => installmentPlan(...args, "method"));
  }
  for (const value of ["-1", "100,01", "NaN", "70.123"]) assert.equal(entryFromPercent(10000, value), null);
});
