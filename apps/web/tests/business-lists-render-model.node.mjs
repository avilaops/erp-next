import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { createRequire, registerHooks } from "node:module"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const sourceRoot = new URL("../src/", import.meta.url).href
const nextRoot = new URL("./", pathToFileURL(require.resolve("next/package.json")))
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/") || (specifier.startsWith(".") && context.parentURL?.startsWith(sourceRoot))) {
      const base = specifier.startsWith("@/") ? new URL(specifier.slice(2), sourceRoot) : new URL(specifier, context.parentURL)
      for (const suffix of ["", ".ts", ".tsx"]) if (existsSync(fileURLToPath(base.href + suffix))) return { url: base.href + suffix, shortCircuit: true }
    }
    if (/^next\/[a-z-]+$/.test(specifier)) return { url: new URL(`${specifier.slice(5)}.js`, nextRoot).href, shortCircuit: true }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith(".css")) return { format: "module", source: "export default {}", shortCircuit: true }
    if (url.endsWith("/hooks/use-operation.ts")) return { format: "module", source: `
      export function useResource(url) { globalThis.businessRequests.push(url); return globalThis.businessResult }
      export function useCommand() { return {} }
      export function quantity(raw) { return raw }
    `, shortCircuit: true }
    if (url.startsWith(sourceRoot) && /\.tsx?$/.test(url)) return { format: "module", source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, shortCircuit: true }
    return next(url, context)
  },
})
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime.js")
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime.js")
const { Receivables } = await import("../src/features/finance/receivables.tsx")
const { Payables } = await import("../src/features/purchasing/payables.tsx")
const { PurchaseList } = await import("../src/features/purchasing/purchase-list.tsx")
const { Orders } = await import("../src/features/sales/orders.tsx")
const { Proposals } = await import("../src/features/sales/proposals.tsx")
const { SalesPipeline } = await import("../src/features/sales/sales-pipeline.tsx")
const { SalesWorkspace } = await import("../src/features/sales/sales-workspace.tsx")
const h = React.createElement
function render(Component, query = "", value = { data: [], total: 0, canEdit: false, totals: [] }, error = "") {
  globalThis.businessRequests = []
  globalThis.businessResult = { value: error ? null : value, loading: false, error, status: error ? 503 : 200, reload() {} }
  return renderToStaticMarkup(h(AppRouterContext.Provider, { value: { push() {} } }, h(PathnameContext.Provider, { value: "/vendas/propostas" }, h(SearchParamsContext.Provider, { value: new URLSearchParams(query) }, h(Component)))))
}

for (const [Component, title, headers, keys] of [
  [Receivables, "Contas a receber", 6, ["customerName", "dueDate", "amount", "outstandingAmount", "status", "orderNumber"]],
  [Payables, "Contas a pagar", 5, ["supplierName", "dueDate", "amount", "outstandingAmount", "status"]],
  [PurchaseList, "Pedidos de compra", 4, ["supplierName", "status", "dueDate", "amount"]],
  [Orders, "Pedidos de venda", 5, ["number", "customerName", "status", "dueDate", "amount"]],
  [Proposals, "Propostas", 5, ["customerName", "status", "version", "validUntil", "amount"]],
  [SalesPipeline, "Funil comercial", 4, ["title", "companyName", "stage", "estimatedCents"]],
]) test(`${title}: empty list keeps a single title and all sortable native headers; requests carry sort and offset`, () => {
  for (const key of keys) {
    const html = render(Component, `offset=25&sortBy=${key}&sortOrder=desc`)
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1)
    assert.ok(html.includes(title))
    assert.equal((html.match(/<th[^>]+scope="col"/g) || []).length, headers)
    assert.equal((html.match(/aria-sort=/g) || []).length, headers)
    assert.equal((html.match(/aria-sort="descending"/g) || []).length, 1)
    assert.match(html, /workspace-list-empty/)
    assert.match(html, /role="region"/)
    const request = new URL(globalThis.businessRequests.at(-1), "https://erp.test")
    assert.equal(request.searchParams.get("sortBy"), key)
    assert.equal(request.searchParams.get("sortOrder"), "desc")
    assert.equal(request.searchParams.get("offset"), "25")
  }
})

test("errors stay distinct from empty; contextual creation respects server permissions", () => {
  for (const Component of [Receivables, Payables, PurchaseList, Orders, Proposals, SalesPipeline]) {
    const html = render(Component, "", undefined, "Consulta indisponível")
    assert.match(html, /Consulta indisponível/)
    assert.doesNotMatch(html, /workspace-list-empty/)
  }
  for (const Component of [PurchaseList, Orders, Proposals, SalesPipeline]) {
    assert.doesNotMatch(render(Component), /href="[^\"]*\/(?:novo|nova)"/)
    assert.match(render(Component, "", { data: [], total: 0, canEdit: true, totals: [] }), /href="[^\"]*\/(?:novo|nova)"/)
  }
})

test("dashboard sends independent canonical sorts to five-row endpoints", () => {
  const html = render(SalesWorkspace, "proposalsSortBy=amount&proposalsSortOrder=asc&ordersSortBy=number&ordersSortOrder=desc")
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1)
  assert.equal((html.match(/<table[\s>]/g) || []).length, 2)
  const [proposal, order] = globalThis.businessRequests.map(url => new URL(url, "https://erp.test"))
  assert.equal(proposal.searchParams.get("limit"), "5")
  assert.equal(proposal.searchParams.get("sortBy"), "amount")
  assert.equal(order.searchParams.get("limit"), "5")
  assert.equal(order.searchParams.get("sortBy"), "number")
  assert.equal(order.searchParams.get("sortOrder"), "desc")
})

test("monetary cells keep fixed-point precision, virtual expired labels, installments and commercial order numbers", () => {
  const row = { id: "record", customerName: "Academia", supplierName: "Fornecedor", dueDate: "2026-12-31", validUntil: null, amount: "999999999999.99", outstandingAmount: "10.00", receivedAmount: "0.00", paidAmount: "0.00", status: "sent", expired: true, version: 2, orderId: "technical-id", orderNumber: "10", installmentKind: "balance", installmentNumber: 2 }
  const value = { data: [row], total: 1, canEdit: false }
  const proposal = render(Proposals, "", value)
  assert.match(proposal, /workspace-currency-cell[^>]*>R\$ 999\.999\.999\.999,99<\/td>/)
  assert.match(proposal, /data-tone="warning">Expirada<\/span>/)
  const account = render(Receivables, "", value)
  assert.match(account, /Parcela 2/)
  assert.match(account, /PV-000010/)
  assert.doesNotMatch(account, />technical-id<\/td>/)
  assert.match(account, /workspace-currency-cell[^>]*>R\$ 10,00<\/td>/)
})
