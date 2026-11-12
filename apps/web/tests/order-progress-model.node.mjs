import test from "node:test"
import assert from "node:assert/strict"
import { orderIssuesBySection, orderedOrderIssues } from "../src/features/sales/order-progress.ts"

test("order review follows the selling sequence and focuses a field only once", () => {
  const input = [
    { field: "checkout.entry-method", section: "payment", message: "Escolha a entrada" },
    { field: "customer.taxId", section: "customer", message: "Informe CNPJ" },
    { field: "equipment.search", section: "equipment", message: "Adicione equipamento" },
    { field: "customer.taxId", section: "customer", message: "Documento inválido" },
    { field: "checkout.manufacturing", section: "delivery", message: "Informe prazo" },
    { field: "discount.percent", section: "discount", message: "Confira desconto" },
  ]
  const sorted = orderedOrderIssues(input)
  assert.deepEqual(sorted.map(issue => issue.field), ["equipment.search", "customer.taxId", "checkout.manufacturing", "discount.percent", "checkout.entry-method"])
  assert.equal(sorted[1].message, "Informe CNPJ")
  assert.equal(input.length, 6)
  assert.deepEqual(orderIssuesBySection(sorted).map(group => [group.id, group.issues.length]), [["equipment", 1], ["customer", 1], ["delivery", 1], ["discount", 1], ["payment", 1]])
})

test("completed sections do not leave empty warnings in review", () => {
  assert.deepEqual(orderIssuesBySection([]), [])
  assert.deepEqual(orderedOrderIssues([]), [])
})
