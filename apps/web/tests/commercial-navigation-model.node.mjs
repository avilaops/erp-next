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

test("sorting survives line, search, destination, cart and simulator navigation", () => {
  const query = navigation.readCommercialTableQuery(new URLSearchParams({ q: "Treino", offset: "28", sortBy: "priceWithIpiCents", sortOrder: "desc", destinationState: "MG", itens: `${first}:2` }))
  const href = navigation.commercialTableHref({ ...query, line: "national", q: "Treino 10", destinationState: "SP" })
  const params = new URL(href, "https://erp.local").searchParams
  assert.equal(params.get("sortBy"), "priceWithIpiCents")
  assert.equal(params.get("sortOrder"), "desc")
  assert.equal(params.get("offset"), "28")
  assert.equal(params.get("itens"), `${first}:2`)
  const simulation = new URL(navigation.commercialSimulationHref(query), "https://erp.local")
  const back = new URL(navigation.commercialTableReturn(simulation.searchParams.get("returnTo"), "imported"), "https://erp.local")
  assert.equal(back.searchParams.get("sortBy"), "priceWithIpiCents")
  assert.equal(back.searchParams.get("sortOrder"), "desc")
})

test("invalid commercial sort parameters are discarded safely", () => {
  for (const values of [{ sortBy: "price;delete", sortOrder: "desc" }, { sortBy: "name", sortOrder: "DROP" }, { sortOrder: "desc" }]) {
    const href = navigation.commercialTableHref(navigation.readCommercialTableQuery(new URLSearchParams(values)))
    assert.equal(new URL(href, "https://erp.local").searchParams.has("sortBy"), false)
    assert.equal(new URL(href, "https://erp.local").searchParams.has("sortOrder"), false)
  }
})

test("complete commercial prices sort numerically before the fourteen-row page and keep unavailable values last", () => {
  assert.equal(typeof navigation.commercialTableRows, "function")
  const rows = Array.from({ length: 20 }, (_, index) => ({ productId: String(index).padStart(2, "0"), name: `Árvore ${20 - index}`, sku: `EQ-${20 - index}`, priceWithIpiCents: (20 - index) * 100, minOwnPriceWithIpiCents: index === 0 ? null : (20 - index) * 100 }))
  const query = navigation.readCommercialTableQuery(new URLSearchParams({ sortBy: "priceWithIpiCents", offset: "14" }))
  const sorted = navigation.commercialTableRows(rows, query)
  assert.deepEqual(sorted.slice(14, 20).map(row => row.priceWithIpiCents), [1500, 1600, 1700, 1800, 1900, 2000])
  assert.equal(rows[0].priceWithIpiCents, 2000)
  const descending = navigation.readCommercialTableQuery(new URLSearchParams({ sortBy: "minOwnPriceWithIpiCents", sortOrder: "desc" }))
  assert.equal(navigation.commercialTableRows(rows, descending).at(-1).minOwnPriceWithIpiCents, null)
  const names = navigation.readCommercialTableQuery(new URLSearchParams({ sortBy: "name", q: "árvore" }))
  assert.deepEqual(navigation.commercialTableRows(rows, names).slice(0, 3).map(row => row.name), ["Árvore 1", "Árvore 2", "Árvore 3"])
})

test("unsorted commercial results preserve original publication order", () => {
  assert.equal(typeof navigation.commercialTableRows, "function")
  const rows = [{ productId: "b", name: "Zeta", sku: "2" }, { productId: "a", name: "Alfa", sku: "1" }]
  assert.deepEqual(navigation.commercialTableRows(rows, navigation.readCommercialTableQuery(new URLSearchParams())), rows)
})
