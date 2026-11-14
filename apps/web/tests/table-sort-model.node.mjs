import assert from "node:assert/strict"
import { test } from "node:test"
import { readTableSort, nextTableSort, sortTableRows, tableSortQuery, tableSortHref } from "../src/components/workspace/table-sort-model.ts"

const initial = { by: "createdAt", order: "desc" }
const allowed = ["createdAt", "name", "price"]

test("missing and malformed sort preserve the screen default without opting into a new order", () => {
  for (const query of ["", "sortOrder=asc", "sortBy=unknown&sortOrder=desc", "sortBy=name&sortOrder=invalid", "sortBy=name&sortOrder="]) {
    const sort = readTableSort(new URLSearchParams(query), allowed, initial)
    assert.deepEqual(sort, { ...initial, explicit: false }, query)
    assert.equal(tableSortQuery(sort).toString(), "")
  }
  assert.deepEqual(readTableSort(new URLSearchParams("sortBy=name"), allowed, initial), { by: "name", order: "asc", explicit: true })
  assert.deepEqual(readTableSort(new URLSearchParams("sortBy=price&sortOrder=desc"), allowed, initial), { by: "price", order: "desc", explicit: true })
})

test("first explicit click ascends even when the default already sorts that column ascending", () => {
  const first = nextTableSort({ by: "name", order: "asc", explicit: false }, "name")
  assert.deepEqual(first, { by: "name", order: "asc", explicit: true })
  const second = nextTableSort(first, "name")
  assert.deepEqual(second, { by: "name", order: "desc", explicit: true })
  assert.deepEqual(nextTableSort(second, "name"), first)
  assert.deepEqual(nextTableSort(second, "price"), { by: "price", order: "asc", explicit: true })
})

test("URL changes retain duplicate filters, page, page size, selection, destination and hash", () => {
  const href = tableSortHref("/vendas/tabela-precos?q=Treino&offset=14&limit=14&filter=a&filter=b&itens=id%3A2&destinationState=MG#prices", { by: "price", order: "desc", explicit: true })
  assert.equal(href, "/vendas/tabela-precos?q=Treino&offset=14&limit=14&filter=a&filter=b&itens=id%3A2&destinationState=MG&sortBy=price&sortOrder=desc#prices")
  assert.equal(tableSortHref("/list?sortBy=price&sortOrder=desc&offset=25", { ...initial, explicit: false }), "/list?offset=25")
  assert.equal(tableSortQuery({ by: "price", order: "desc", explicit: true }).toString(), "sortBy=price&sortOrder=desc")
})

test("prefixed tables retain each other's state and expose canonical API sort keys", () => {
  const params = new URLSearchParams("ordersSortBy=price&ordersSortOrder=desc&sortBy=name&sortOrder=asc")
  const sort = readTableSort(params, allowed, initial, "orders")
  assert.deepEqual(sort, { by: "price", order: "desc", explicit: true })
  assert.equal(tableSortQuery(sort).toString(), "sortBy=price&sortOrder=desc")
  assert.equal(tableSortHref(`/sales?${params}`, nextTableSort(sort, "price"), "orders"), "/sales?ordersSortBy=price&ordersSortOrder=asc&sortBy=name&sortOrder=asc")
})

const sortedIds = (rows, field, order = "asc") => sortTableRows(rows, { by: field, order, explicit: true }, { value: row => row.value }, row => row.id).map(row => row.id)

test("Portuguese text ignores accents and case, sorts numbers naturally and breaks ties by unique key", () => {
  const rows = Object.freeze([{ id: "z", value: "Árvore 10" }, { id: "b", value: "arvore 2" }, { id: "a", value: "ÁRVORE 2" }, { id: "n", value: null }])
  assert.deepEqual(sortedIds(rows, "value"), ["a", "b", "z", "n"])
  assert.deepEqual(sortedIds(rows, "value", "desc"), ["z", "a", "b", "n"])
  assert.equal(rows[0].id, "z")
})

test("numbers, bigint and dates sort by typed values with null last in either direction", () => {
  const fixtures = [[100, 2, 10], [100n, 2n, 10n], [new Date("2026-10-01"), new Date("2026-02-01"), new Date("2026-03-01")]]
  for (const values of fixtures) {
    const rows = values.map((value, id) => ({ id, value })).concat([{ id: 3, value: null }])
    assert.deepEqual(sortedIds(rows, "value"), [1, 2, 0, 3])
    assert.deepEqual(sortedIds(rows, "value", "desc"), [0, 2, 1, 3])
  }
  assert.deepEqual(sortedIds([{ id: "z", value: "a" }, { id: "á", value: "a" }, { id: "a", value: "a" }], "value"), ["a", "z", "á"])
})

test("sorting a complete collection precedes local slicing and treats nonfinite values as missing", () => {
  const rows = [{ id: 1, value: 100 }, { id: 2, value: null }, { id: 3, value: 2 }, { id: 4, value: 10 }, { id: 5, value: NaN }, { id: 6, value: new Date("invalid") }]
  assert.deepEqual(sortedIds(rows, "value").slice(0, 2), [3, 4])
  assert.deepEqual(sortedIds(rows, "value", "desc"), [1, 4, 3, 2, 5, 6])
})
