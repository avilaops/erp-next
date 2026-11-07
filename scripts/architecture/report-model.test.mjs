import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
async function load(relative) {
  const source = await readFile(new URL("../../apps/web/src/" + relative, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
  return import("data:text/javascript;base64," + Buffer.from(outputText).toString("base64"));
}
const model = await load("features/reports/report-model.ts");
const { serializeCsv } = await load("lib/csv-export.ts");

test("financial totals exclude cancelled accounts and count open titles", () => {
  const base = { id: "1", amount: "100", outstandingAmount: "25", status: "open", dueDate: "2026-11-07" };
  const accounts = [base, { ...base, id: "2", status: "cancelled", outstandingAmount: "900" }, { ...base, id: "3", status: "paid", outstandingAmount: "0" }];
  assert.deepEqual(model.financeMetrics(accounts, []), { toReceive: 25, toPay: 0, openReceivables: 1, openPayables: 0 });
  assert.equal(model.financeRows([base], [base]).length, 2);
});

test("stock page metrics distinguish directory total from quantities on the page", () => {
  assert.deepEqual(model.stockMetrics({ total: 200, data: [
    { quantity: "12.5", reserved: "2", available: "10.5" },
    { quantity: "0", reserved: "0", available: "0" },
  ] }), { products: 200, quantity: 12.5, reserved: 2, unavailable: 1 });
  assert.deepEqual(model.stockMetrics(null), { products: 0, quantity: 0, reserved: 0, unavailable: 0 });
});

test("CSV retains decimal strings, delimiters, quotes and multiline cells", () => {
  assert.equal(serializeCsv([["Nome", "Saldo"], ['Produto; "A"\nB', "001.50"]]), '"Nome";"Saldo"\r\n"Produto; ""A""\nB";"001.50"');
  assert.equal(model.stockExportRows([]).length, 1);
  assert.equal(model.financeExportRows([], []).length, 1);
});
