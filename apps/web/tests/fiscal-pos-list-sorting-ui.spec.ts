import { expect, test, type Page } from "@playwright/test"
import { createServer } from "node:http"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

const access = { tenant: { id: tenant, legalName: "Empresa teste" }, permissions: ["sales.pos.read", "sales.pos.manage", "fiscal.nfe.read"] }
const upstream = createServer((_request, response) => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(access)) })
test.beforeAll(async () => { await new Promise<void>((resolve, reject) => { upstream.once("error", reject); upstream.listen(Number(process.env.ERP_FISCAL_POS_UPSTREAM_PORT || 33950), "127.0.0.1", resolve) }) })
test.afterAll(async () => { if (upstream.listening) await new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve())) })
test.beforeEach(async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  await page.route("**/api/erp/me", route => route.fulfill({ json: access }))
})

async function containedAtWidths(page: Page, info: { outputPath: (name: string) => string }, name: string) {
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    for (const region of await page.locator(".workspace-responsive-table").all()) {
      expect(await region.evaluate(element => element.getBoundingClientRect().right <= innerWidth + 1)).toBe(true)
    }
    await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true })
  }
}

test("NF-e exhausts both cursor streams before typed sorting and keeps filters on browser back", async ({ page }, info) => {
  const drafts = Array.from({ length: 130 }, (_, index) => ({ id: `draft-${index}`, productsTotal: `${index + 10}.00`, createdAt: "2026-11-01T12:00:00Z", input: { environment: "homologation", model: 55, recipient: { legalName: "Árvore cliente", taxId: "11222333000181" } } }))
  const requests: URLSearchParams[] = []
  await page.route(/\/api\/erp\/fiscal\/nfe\?/, route => {
    const query = new URL(route.request().url()).searchParams; requests.push(query)
    return route.fulfill({ json: { tenantId: tenant, data: query.has("cursor") ? drafts.slice(100) : drafts.slice(0, 100), nextCursor: query.has("cursor") ? null : "next-page" } })
  })
  await page.route(/\/api\/erp\/fiscal\/issued-nfes\?/, route => {
    requests.push(new URL(route.request().url()).searchParams)
    return route.fulfill({ json: { tenantId: tenant, data: [{ id: record, status: "authorized", environment: "homologation", model: 55, number: 2, series: 1, recipientName: "Árvore menor valor", recipientTaxId: "11222333000181", amount: "0.01", issuedAt: "2026-11-01T12:00:00Z" }], nextCursor: null } })
  })
  await page.route("**/api/erp/fiscal/readiness", route => route.fulfill({ json: { tenantId: tenant, profileConfigured: true, environment: "homologation" } }))
  await page.route("**/api/erp/fiscal/certificate", route => route.fulfill({ status: 404, json: {} }))
  await page.goto("/fiscal/notas-saida?q=Árvore&environment=homologation&returnTo=keep#records")
  await expect(page.getByText("131 nota(s)", { exact: true })).toBeVisible()
  const table = page.getByRole("table")
  await table.getByRole("button", { name: "Valor dos produtos", exact: true }).press("Enter")
  await expect(table.locator("tbody tr").first()).toContainText("NF-e 2 / 1")
  expect(requests.some(query => query.has("cursor"))).toBe(true)
  expect(requests.every(query => !query.has("sortBy"))).toBe(true)
  expect(new URL(page.url()).searchParams.get("q")).toBe("Árvore")
  await table.getByRole("button", { name: "Valor dos produtos", exact: true }).press("Enter")
  await expect(table.locator("tbody tr").first()).not.toContainText("NF-e 2 / 1")
  await page.goBack()
  await expect(table.locator("tbody tr").first()).toContainText("NF-e 2 / 1")
  await expect(page.locator("main h1")).toHaveCount(1)
  await expect(page.getByRole("link", { name: "Preparar nota", exact: true })).toHaveCount(0)
  await containedAtWidths(page, info, "nfe-lists")
  await page.getByLabel("Buscar nota", { exact: true }).fill("inexistente")
  await page.getByRole("button", { name: "Buscar", exact: true }).click()
  await expect(page.getByText("Nenhum resultado encontrado", { exact: true })).toBeVisible()
  await expect(table.getByRole("columnheader")).toHaveCount(6)
})

test("XML import list forwards global sort before its limit and retains period, offset and unrelated URL state", async ({ page }, info) => {
  const rows = Array.from({ length: 80 }, (_, index) => ({ id: index + 1, accessKey: "35261012345678000195550010000001231482917364", issuerDocument: "12345678000195", issuerName: "Empresa teste", recipientDocument: "11222333000181", recipientName: `Árvore ${index + 1}`, number: index + 1, series: 1, issuedAt: "2026-11-01T12:00:00Z", totalCents: (80 - index) * 100, itemCount: 1, environment: 2, xmlSha256: "a".repeat(64), createdAt: "2026-11-01T12:00:00Z" }))
  const requests: URLSearchParams[] = []
  await page.route(/\/api\/erp\/fiscal\/outgoing-imports\?/, route => {
    const query = new URL(route.request().url()).searchParams; requests.push(query)
    const sorted = [...rows].sort((a, b) => query.get("sortBy") === "totalCents" ? (a.totalCents - b.totalCents) * (query.get("sortOrder") === "desc" ? -1 : 1) : a.id - b.id)
    const offset = Number(query.get("offset") || 0)
    return route.fulfill({ json: { tenantId: tenant, canImport: false, total: rows.length, data: sorted.slice(offset, offset + 25) } })
  })
  await page.goto("/fiscal/notas-saida/importar?q=Árvore&from=2026-11-01&to=2026-11-13&offset=25&returnTo=keep#xml")
  const table = page.getByRole("table")
  await expect(table).toBeVisible()
  await expect(table.getByRole("columnheader", { name: "Emissão", exact: true })).toHaveAttribute("aria-sort", "none")
  await table.getByRole("button", { name: "Total", exact: true }).press("Enter")
  await expect.poll(() => requests.at(-1)?.get("sortBy")).toBe("totalCents")
  await expect(table.locator("tbody tr").first()).toContainText("NF-e 55 / 1")
  expect(requests.at(-1)?.get("offset")).toBe("25")
  expect(requests.at(-1)?.get("from")).toBe("2026-11-01")
  expect(new URL(page.url()).hash).toBe("#xml")
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe("keep")
  await page.getByRole("button", { name: "Próxima", exact: true }).click()
  await expect.poll(() => requests.at(-1)?.get("offset")).toBe("50")
  expect(requests.at(-1)?.get("sortBy")).toBe("totalCents")
  await containedAtWidths(page, info, "xml-import-list")
})

const totals = { cash: "0.00", pix: "0.00", debit: "0.00", credit: "0.00", supplies: "0.00", withdrawals: "0.00", refunds: "0.00", expectedCash: "20.00", countedCash: "20.00", difference: "0.00" }
const session = { id: record, register: "Principal", cashAccountId: "44444444-4444-4444-8444-444444444444", openingAmount: "20.00", status: "closed", revision: 1, openedAt: "2026-11-01T12:00:00Z", closedAt: "2026-11-01T13:00:00Z", totals, sales: [], movements: [] }

test("POS product server sorting preserves a locally selected cart and price context", async ({ page }, info) => {
  await page.route("**/api/erp/company", route => route.fulfill({ json: { tenantId: tenant, data: { state: "SP" } } }))
  await page.route("**/api/erp/financial-accounts?**", route => route.fulfill({ json: { tenantId: tenant, data: [{ id: session.cashAccountId, accountType: "cash", status: "active", name: "Caixa", code: "CX" }], total: 1 } }))
  await page.route("**/api/erp/pos/sessions/current?**", route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: { ...session, status: "open" } } }))
  const products = Array.from({ length: 60 }, (_, index) => ({ id: `product-${index}`, name: `Árvore ${index + 1}`, sku: `P-${index}`, unit: "UN", unitPrice: `${60 - index}.00`, available: "5.000000", pricingAvailable: true }))
  const requests: URLSearchParams[] = []
  await page.route("**/api/erp/pos/products?**", route => {
    const query = new URL(route.request().url()).searchParams; requests.push(query)
    const sorted = [...products].sort((a, b) => query.get("sortBy") === "price" ? (Number(a.unitPrice) - Number(b.unitPrice)) * (query.get("sortOrder") === "desc" ? -1 : 1) : a.name.localeCompare(b.name, "pt-BR", { numeric: true }))
    const offset = Number(query.get("offset") || 0)
    return route.fulfill({ json: { tenantId: tenant, data: sorted.slice(offset, offset + 15), total: products.length } })
  })
  await page.goto("/vendas/pdv?productSearch=Árvore&productOffset=15&returnTo=keep")
  const table = page.getByRole("table", { name: "Produtos disponíveis no PDV", exact: true })
  await expect(table).toBeVisible()
  await table.getByRole("button", { name: "Adicionar Árvore 16", exact: true }).click()
  await table.getByRole("button", { name: "Preço", exact: true }).press("Enter")
  await expect.poll(() => requests.at(-1)?.get("sortBy")).toBe("price")
  await expect(table.locator("tbody tr").first()).toContainText("Árvore 45")
  await expect(page.getByRole("table", { name: "Itens da venda", exact: true })).toContainText("Árvore 16")
  expect(requests.at(-1)?.get("destination")).toBe("SP")
  expect(requests.at(-1)?.get("taxpayer")).toBe("false")
  expect(requests.at(-1)?.get("offset")).toBe("15")
  await expect(page.locator("main h1")).toHaveCount(1)
  await containedAtWidths(page, info, "pos-products")
})

test("cash movements paginate all seventy-three records and isolate sales sorting", async ({ page }, info) => {
  await page.route(`**/api/erp/pos/sessions/${record}`, route => route.fulfill({ json: { tenantId: tenant, canEdit: false, data: session } }))
  const movements = Array.from({ length: 73 }, (_, index) => ({ id: `movement-${index}`, direction: index % 2 ? "supply" : "withdrawal", amount: `${73 - index}.00`, reason: `Movimento ${index + 1}`, createdAt: "2026-11-01T12:00:00Z" }))
  const requests: URLSearchParams[] = [], saleRequests: URLSearchParams[] = []
  await page.route(`**/api/erp/pos/sessions/${record}/movements?**`, route => {
    const query = new URL(route.request().url()).searchParams; requests.push(query)
    const sorted = [...movements].sort((a, b) => query.get("sortBy") === "amount" ? (Number(a.amount) - Number(b.amount)) * (query.get("sortOrder") === "desc" ? -1 : 1) : a.id.localeCompare(b.id))
    const offset = Number(query.get("offset") || 0)
    return route.fulfill({ json: { tenantId: tenant, data: sorted.slice(offset, offset + 50), total: movements.length, offset, limit: 50 } })
  })
  await page.route("**/api/erp/pos/sales?**", route => { saleRequests.push(new URL(route.request().url()).searchParams); return route.fulfill({ json: { tenantId: tenant, data: [], total: 0 } }) })
  await page.goto(`/vendas/pdv/fechamento?caixa=${record}&movementsOffset=50&returnTo=keep#cash`)
  const table = page.getByRole("table", { name: "Movimentações do caixa", exact: true })
  await expect(table.locator("tbody tr")).toHaveCount(23)
  await table.getByRole("button", { name: "Valor", exact: true }).press("Enter")
  await expect.poll(() => requests.at(-1)?.get("sortBy")).toBe("amount")
  await expect(table.locator("tbody tr").first()).toContainText("Movimento 23")
  expect(requests.at(-1)?.get("offset")).toBe("50")
  expect(requests.at(-1)?.get("limit")).toBe("50")
  const salesTable = page.getByRole("table", { name: "Vendas do caixa", exact: true })
  await salesTable.getByRole("button", { name: "Total", exact: true }).press("Enter")
  await expect.poll(() => saleRequests.at(-1)?.get("sortBy")).toBe("total")
  expect(new URL(page.url()).searchParams.get("movementsSortBy")).toBe("amount")
  expect(new URL(page.url()).searchParams.get("caixa")).toBe(record)
  expect(new URL(page.url()).hash).toBe("#cash")
  await expect(salesTable.getByRole("columnheader")).toHaveCount(4)
  await expect(page.getByText("Nenhuma venda registrada", { exact: true })).toBeVisible()
  await containedAtWidths(page, info, "cash-movements")
})

test("session history sends scoped sort with retained filters and page", async ({ page }) => {
  const requests: URLSearchParams[] = []
  await page.route("**/api/erp/pos/sessions?**", route => { requests.push(new URL(route.request().url()).searchParams); return route.fulfill({ json: { tenantId: tenant, data: [session], total: 60 } }) })
  await page.goto("/vendas/pdv/historico?status=closed&register=Principal&offset=20&returnTo=keep")
  const table = page.getByRole("table", { name: "Histórico dos caixas", exact: true })
  await table.getByRole("button", { name: "Caixa", exact: true }).press("Enter")
  await expect.poll(() => requests.at(-1)?.get("sortBy")).toBe("register")
  expect(requests.at(-1)?.get("offset")).toBe("20")
  expect(requests.at(-1)?.get("status")).toBe("closed")
  await page.getByRole("button", { name: "Próxima", exact: true }).click()
  await expect.poll(() => requests.at(-1)?.get("offset")).toBe("40")
  expect(requests.at(-1)?.get("sortBy")).toBe("register")
  await page.goBack()
  await expect.poll(() => requests.at(-1)?.get("offset")).toBe("20")
  await page.getByRole("button", { name: "Limpar", exact: true }).click()
  await expect.poll(() => requests.at(-1)?.get("status") || "").toBe("")
  expect(requests.at(-1)?.get("sortBy")).toBe("register")
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe("keep")
})
