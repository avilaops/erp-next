import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import ts from "typescript"

const input = readFileSync(new URL("../src/features/pos/pos-model.ts", import.meta.url), "utf8").replace('"@/lib/decimal-input"', JSON.stringify(new URL("../src/lib/decimal-input.ts", import.meta.url).href))
const code = ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const model = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"))
test("POS preview uses integer micro quantities and one half-up cent rounding", () => {
  assert.equal(model.lineCents({ quantity: "1.005", unitPrice: "19.99" }), 2009)
  assert.equal(model.lineCents({ quantity: "0,5", unitPrice: "0.01" }), 1)
  assert.equal(model.cartCents([{ quantity: "1.005", unitPrice: "19.99" }, { quantity: "2", unitPrice: "50.00" }]), 12009)
})
test("POS input rejects exponents/grouping and keeps large accepted totals precise", () => {
  assert.equal(model.cents("1e3"), null)
  assert.equal(model.cents("1.000,00"), null)
  assert.equal(model.lineCents({ quantity: "1e6", unitPrice: "50.00" }), null)
  assert.equal(model.lineCents({ quantity: "1000000", unitPrice: "999999.99" }), 99999999000000)
  assert.equal(model.cartCents([{ quantity: "", unitPrice: "50.00" }]), null)
})
test("POS formatting preserves explicit zero, shortages and Brazilian input", () => {
  assert.equal(model.amount("20,5"), "20.50")
  assert.equal(model.cents("-2.00"), -200)
  assert.equal(model.cents("0"), 0)
  assert.match(model.money("-2.00"), /-.*2,00/)
  assert.equal(model.decimal(12009), "120.09")
})
