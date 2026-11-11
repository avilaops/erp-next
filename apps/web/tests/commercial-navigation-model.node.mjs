import assert from "node:assert/strict"
import { test } from "node:test"
import * as navigation from "../src/features/sales/commercial-navigation-model.ts"

const first = "33333333-3333-4333-8333-333333333333"
const second = "44444444-4444-4444-8444-444444444444"

test("table URL preserves cart, destination, search and pagination through simulator return", () => {
  const query = navigation.readCommercialTableQuery(new URLSearchParams({ linha: "national", q: " Treino ", offset: "15", destinationState: "mg", taxpayer: "true", itens: `${first}:2,${second}:1000000` }))
  assert.deepEqual(query, { line: "national", q: "Treino", offset: 14, destinationState: "MG", taxpayer: true, items: [{ productId: first, quantity: 2 }, { productId: second, quantity: 1000000 }] })
  const href = navigation.commercialTableHref(query)
  assert.deepEqual(navigation.readCommercialTableQuery(new URL(href, "https://erp.local").searchParams), query)
  const simulator = new URL(navigation.commercialSimulationHref(query), "https://erp.local")
  assert.equal(simulator.searchParams.get("linha"), "national")
  assert.equal(simulator.searchParams.get("destinationState"), "MG")
  assert.equal(simulator.searchParams.get("taxpayer"), "true")
  assert.deepEqual(navigation.readCommercialItems(simulator.searchParams.get("itens")), query.items)
  assert.equal(navigation.commercialTableReturn(simulator.searchParams.get("returnTo"), "national"), href)
})

test("invalid or ambiguous carts are rejected without partially selecting products", () => {
  assert.equal(typeof navigation.readCommercialItems, "function")
  for (const value of [undefined, null, "", "invalid:1", `${first}:0`, `${first}:1000001`, `${first}:1.5`, `${first}:1e2`, `${first}:-1`, `${first}:1,`, `${first}:1,${first}:2`, `${first}:1,invalid:2`]) assert.deepEqual(navigation.readCommercialItems(value), [], String(value))
  const ids = Array.from({ length: 101 }, (_, i) => `${i.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111:1`)
  assert.equal(navigation.readCommercialItems(ids.slice(0, 100).join(",")).length, 100)
  assert.deepEqual(navigation.readCommercialItems(ids.join(",")), [])
})

test("singular simulation links and old table URLs remain compatible", () => {
  assert.equal(navigation.commercialTableHref({ line: "imported", q: "", offset: 0 }), "/vendas/tabela-precos")
  const query = navigation.readCommercialTableQuery(new URLSearchParams(`q=Treino&offset=14&itens=${first}:3`))
  const singular = new URL(navigation.commercialSimulationHref(query, second), "https://erp.local")
  assert.equal(singular.searchParams.get("produto"), second)
  assert.equal(singular.searchParams.has("itens"), false)
  assert.equal(singular.searchParams.get("returnTo"), navigation.commercialTableHref(query))
})

test("return path and destination parser reject external navigation and invalid UF", () => {
  for (const value of ["https://evil.test/vendas/tabela-precos", "//evil.test/vendas/tabela-precos", "/vendas/tabela-precos-externa", "/vendas/tabela-precos/../pedidos"]) assert.equal(navigation.commercialTableReturn(value, "national"), "/vendas/tabela-precos?linha=national")
  const query = navigation.readCommercialTableQuery(new URLSearchParams({ destinationState: "ZZ", taxpayer: "yes", offset: "-1" }))
  assert.equal(query.destinationState, "")
  assert.equal(query.taxpayer, false)
  assert.equal(query.offset, 0)
})
