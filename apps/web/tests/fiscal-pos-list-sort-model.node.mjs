import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { test } from "node:test"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { sortTableRows, readTableSort, tableSortQuery } from "../src/components/workspace/table-sort-model.ts"
import { noteStatus } from "../src/features/fiscal/outgoing-nfe-model.ts"

// Compile the real feature module without loading its unrelated interactive forms.
async function featureFunctions(path) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8").replace(/^import .*$/gm, "")
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
  return import("data:text/javascript;base64," + Buffer.from("const {React,useState,useSearchParams,useRouter,useResource,useCommand,useTableSort,DataTable,SortableTableHeader,ResponsiveTable,EmptyState,StatusBadge,CurrencyCell,Pagination,CashNav,Failure,SessionSummary,SessionSales,money,when,cents,sortTableRows,noteStatus}=globalThis.__fiscalPosSortFixtures;\n" + compiled).toString("base64"))
}

let params = new URLSearchParams(), requests = [], tenant = "company"
const session = { id: "session", register: "Principal", status: "closed", openedAt: "2026-11-01", closedAt: "2026-11-02", revision: 1, movements: [], totals: { expectedCash: "0.00" } }
let movementPage = { tenantId: tenant, total: 73, data: [{ id: "large", direction: "supply", amount: "100.00", reason: "Server first", createdAt: "2026-11-01" }, { id: "small", direction: "withdrawal", amount: "2.00", reason: "Server second", createdAt: "2026-11-02" }] }
const h = React.createElement
globalThis.__fiscalPosSortFixtures = {
  React, useState: React.useState, sortTableRows, noteStatus,
  useSearchParams: () => params, useRouter: () => ({ push() {} }),
  useResource: url => { requests.push(url); return { loading: false, error: "", reload() {}, value: url === "/api/erp/me" ? { permissions: [] } : url.includes("/movements?") ? movementPage : { tenantId: tenant, data: session } } },
  useCommand: () => ({ busy: false, uncertain: false, stale: false }),
  useTableSort: (allowed, initial, prefix) => { const sort = readTableSort(params, allowed, initial, prefix); return { sort, query: tableSortQuery(sort), toggle() {} } },
  DataTable: props => h("table", props), SortableTableHeader: ({ field, sort, children }) => h("th", { "aria-sort": sort.by === field ? sort.order === "asc" ? "ascending" : "descending" : "none" }, children),
  ResponsiveTable: ({ label, children }) => h("div", { role: "region", "aria-label": label, tabIndex: 0 }, children),
  EmptyState: ({ title }) => h("p", null, title), StatusBadge: ({ children }) => h("span", null, children), CurrencyCell: props => h("td", props),
  Pagination: ({ offset, pageSize, total }) => h("nav", { "data-offset": offset, "data-page-size": pageSize, "data-total": total }),
  CashNav: () => null, SessionSummary: () => null, SessionSales: () => null, Failure: ({ message }) => h("p", { role: "alert" }, message),
  money: value => `R$ ${value}`, when: value => value || "—", cents: value => Number(value) * 100,
}
const fiscal = await featureFunctions("../src/features/fiscal/outgoing-nfes.tsx")
const pos = await featureFunctions("../src/features/pos/cash-closing.tsx")
const sort = (by, order = "asc") => ({ by, order, explicit: true })

test("all combined fiscal rows sort by typed number, money, dates and visible status", () => {
  const rows = [
    { id: "c", number: 100, amount: "100.00", date: "2026-10-01T12:00:00Z", recipient: "Árvore 10", status: "draft" },
    { id: "b", number: 10, amount: "10.00", date: "2026-03-01T12:00:00Z", recipient: "Árvore 2", status: "authorized" },
    { id: "a", number: 2, amount: "2.00", date: "2026-02-01T12:00:00Z", recipient: "arvore 2", status: "cancelled" },
    { id: "n", recipient: "Sem destinatário", status: "unknown" },
  ]
  for (const by of ["number", "amount", "date", "recipient"]) {
    assert.deepEqual(fiscal.sortOutgoingNotes(rows, sort(by)).map(row => row.id), ["a", "b", "c", "n"])
  }
  assert.deepEqual(fiscal.sortOutgoingNotes(rows, sort("amount", "desc")).map(row => row.id), ["c", "b", "a", "n"])
  assert.deepEqual(fiscal.sortOutgoingNotes(rows, sort("status")).map(row => row.id), ["b", "a", "c", "n"])
  assert.deepEqual(fiscal.sortOutgoingNotes(rows, { by: "date", order: "desc", explicit: false }), rows)
  assert.equal(rows[0].id, "c")
})

test("cash movements request the globally sorted page beyond the old fifty movement cap", () => {
  params = new URLSearchParams("caixa=session&movementsOffset=50&movementsSortBy=amount&movementsSortOrder=desc&salesSortBy=status&salesSortOrder=asc")
  requests = []
  const html = renderToStaticMarkup(h(pos.CashClosing))
  const request = new URL(requests.find(url => url.includes("/movements?")), "https://fixture.test")
  assert.equal(request.pathname, "/api/erp/pos/sessions/session/movements")
  assert.deepEqual(Object.fromEntries(request.searchParams), { sortBy: "amount", sortOrder: "desc", offset: "50", limit: "50" })
  assert.ok(html.indexOf("Server first") < html.indexOf("Server second"), "preserve server page order")
  assert.match(html, /aria-sort="descending">Valor/)
  assert.match(html, /data-offset="50" data-page-size="50" data-total="73"/)
})

test("empty movement pages retain headers and failures are never shown as empty lists", () => {
  params = new URLSearchParams("caixa=session")
  movementPage = { tenantId: tenant, total: 0, data: [] }
  let html = renderToStaticMarkup(h(pos.CashClosing))
  assert.match(html, /<thead>/)
  assert.match(html, /Nenhuma movimentação registrada/)
  movementPage = { tenantId: "another-company", total: 0, data: [] }
  html = renderToStaticMarkup(h(pos.CashClosing))
  assert.match(html, /role="alert">Movimentações indisponíveis/)
  assert.doesNotMatch(html, /Nenhuma movimentação registrada/)
})
