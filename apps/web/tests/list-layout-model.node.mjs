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
      for (const suffix of ["", ".ts", ".tsx"]) {
        const url = base.href + suffix
        if (existsSync(fileURLToPath(url))) return { url, shortCircuit: true }
      }
    }
    if (specifier === "next/link" || specifier === "next/navigation") return { url: new URL(`${specifier.slice(5)}.js`, nextRoot).href, shortCircuit: true }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.startsWith(sourceRoot) && /\.tsx?$/.test(url)) return { format: "module", source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, shortCircuit: true }
    return next(url, context)
  },
})
const { DataTable, SortableTableHeader } = await import("../src/components/workspace/data-table.tsx")
const { EntityListPage, SearchToolbar, FilterField, StatusBadge, EmptyState, ResponsiveTable, CurrencyCell } = await import("../src/components/workspace/list-layout.tsx")
const { useTableSort } = await import("../src/components/workspace/use-table-sort.ts")
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime.js")
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime.js")
const h = React.createElement

test("native sortable headers announce current order and keep the visible label as the button name", () => {
  let selected
  const props = { field: "name", children: "Produto", onSort: field => { selected = field } }
  for (const [sort, aria, arrow] of [[{ by: "name", order: "asc", explicit: false }, "ascending", "↑"], [{ by: "name", order: "desc", explicit: true }, "descending", "↓"], [{ by: "price", order: "asc", explicit: true }, "none", "↑"], [{ by: "", order: "asc", explicit: false }, "none", "↑"]]) {
    const header = SortableTableHeader({ ...props, sort })
    const html = renderToStaticMarkup(h(DataTable, null, h("thead", null, h("tr", null, header))))
    assert.match(html, new RegExp(`<th[^>]+scope="col"[^>]+aria-sort="${aria}"`))
    assert.match(html, /<button[^>]+type="button"/)
    assert.doesNotMatch(html, /aria-label=/)
    assert.match(html, new RegExp(`<span[^>]+aria-hidden="true"[^>]*>${arrow}</span>`))
    assert.match(html, /workspace-sort-arrow/)
    header.props.children.props.onClick()
    assert.equal(selected, "name")
  }
})

test("empty filtered lists retain a single page title, table headings and labeled scrolling region", () => {
  const html = renderToStaticMarkup(h(EntityListPage, {
    title: "Produtos", actions: h("button", null, "Criar produto"),
    toolbar: h(SearchToolbar, { onSubmit() {}, onClear() {}, canClear: true }, h(FilterField, { label: "Pesquisa" }, h("input", { name: "q", defaultValue: "sem resultado" }))),
    summary: "0 produtos", footer: h("nav", { "aria-label": "Paginação" }, "Página 1"),
  }, h(ResponsiveTable, { label: "Produtos cadastrados" }, h(DataTable, null,
    h("thead", null, h("tr", null, h(SortableTableHeader, { field: "name", sort: { by: "name", order: "asc", explicit: false }, onSort() {} }, "Produto"))),
    h("tbody", null, h("tr", null, h("td", null, h(EmptyState, { filtered: true })))),
  ))))
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1)
  assert.match(html, /<thead>/)
  assert.match(html, /role="region" aria-label="Produtos cadastrados" tabindex="0"/)
  assert.match(html, /Nenhum resultado encontrado/)
  assert.match(html, /Buscar/)
  assert.match(html, /Limpar/)
  assert.match(html, /<label[^>]*>.*Pesquisa.*<input/s)
  assert.ok(html.indexOf("0 produtos") < html.indexOf("<thead>"))
  assert.ok(html.indexOf("Página 1") > html.indexOf("</table>"))
})

test("currency remains a native table cell with the caller's formatted value and status keeps visible text", () => {
  const html = renderToStaticMarkup(h(DataTable, null, h("tbody", null, h("tr", null,
    h(CurrencyCell, { colSpan: 2 }, "R$ 1.234.567,89"), h("td", null, h(StatusBadge, { tone: "success" }, "Ativo")),
  ))))
  assert.match(html, /<td[^>]*colSpan="2"[^>]*class="[^"]*workspace-currency-cell[^\"]*">R\$ 1\.234\.567,89<\/td>/i)
  assert.match(html, /<span[^>]*data-tone="success"[^>]*>Ativo<\/span>/)
})

test("sort hook navigates without losing offset and reads browser history state on the next render", () => {
  let table
  const navigations = []
  function Harness() { table = useTableSort(["name", "price"], { by: "name", order: "asc" }); return null }
  function render(query) {
    globalThis.window.location.search = query ? `?${query}` : ""
    renderToStaticMarkup(h(AppRouterContext.Provider, { value: { push: (...args) => navigations.push(args) } },
      h(PathnameContext.Provider, { value: "/products" }, h(SearchParamsContext.Provider, { value: new URLSearchParams(query) }, h(Harness))),
    ))
  }
  const originalWindow = globalThis.window
  globalThis.window = { location: { pathname: "/products", search: "", hash: "#records" } }
  try {
    render("q=Prensa&offset=25&limit=25&itens=id%3A2")
    assert.deepEqual(table.sort, { by: "name", order: "asc", explicit: false })
    assert.equal(table.query.toString(), "")
    table.toggle("price")
    assert.deepEqual(navigations, [["/products?q=Prensa&offset=25&limit=25&itens=id%3A2&sortBy=price&sortOrder=asc#records", { scroll: false }]])
    render("q=Prensa&offset=25&sortBy=price&sortOrder=asc")
    assert.deepEqual(table.sort, { by: "price", order: "asc", explicit: true })
    assert.equal(table.query.toString(), "sortBy=price&sortOrder=asc")
    table.toggle("unknown")
    assert.equal(navigations.length, 1)
    table.toggle("price")
    assert.equal(navigations[1][0], "/products?q=Prensa&offset=25&sortBy=price&sortOrder=desc#records")
    render("q=Prensa&offset=25&limit=25&itens=id%3A2")
    assert.deepEqual(table.sort, { by: "name", order: "asc", explicit: false })
    globalThis.window.location.search += "&destinationState=MG"
    table.toggle("name")
    assert.match(navigations.at(-1)[0], /destinationState=MG/)
  } finally {
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
  }
})
