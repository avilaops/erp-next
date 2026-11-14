import { expect, test, type Page } from "@playwright/test"
import { createServer } from "node:http"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

const access = { tenant: { id: tenant }, permissions: ["sales.orders.read", "sales.orders.manage", "catalog.products.read", "catalog.products.manage", "platform.company.read", "platform.company.manage", "finance.accounts.read", "finance.accounts.manage", "inventory.stock.read", "inventory.stock.manage", "purchasing.orders.read", "purchasing.orders.manage"] }
const upstream = createServer((_request, response) => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(access)) })
test.beforeAll(async () => { await new Promise<void>(resolve => upstream.listen(33948, "127.0.0.1", resolve)) })
test.afterAll(async () => { await new Promise<void>(resolve => upstream.close(() => resolve())) })
test.beforeEach(async ({ context, baseURL }) => { await installFrontendFixture(context, baseURL); await context.route("**/api/erp/me", route => route.fulfill({ json: access })) })

const row = { id: record, number: "10", productId: record, revision: 1, customerName: "Zeta Academia", supplierName: "Zeta Fornecedor", customerTaxId: "", status: "draft", version: 2, validUntil: "2026-12-31", dueDate: "2026-12-31", amount: "1234567.89", outstandingAmount: "1234567.89", receivedAmount: "0.00", paidAmount: "0.00", orderId: record, orderNumber: "10", expired: false, title: "Projeto Zeta", companyName: "Zeta Academia", contactName: "Contato", stage: "negotiation", estimatedCents: 123456789, name: "Zeta Equipamento", sku: "EQ-10", unit: "UN", quantity: "100.000000", reserved: "2.000000", available: "98.000000" }
const families = [
  { path: "/vendas/pedidos", endpoint: "orders", title: "Pedidos de venda", header: "Valor", field: "amount", columns: 5 },
  { path: "/vendas/propostas", endpoint: "proposals", title: "Propostas", header: "Valor", field: "amount", columns: 5 },
  { path: "/vendas/funil", endpoint: "opportunities", title: "Funil comercial", header: "Valor estimado", field: "estimatedCents", columns: 4 },
  { path: "/financeiro/contas-receber", endpoint: "receivables", title: "Contas a receber", header: "Saldo restante", field: "outstandingAmount", columns: 6 },
  { path: "/financeiro/contas-pagar", endpoint: "financial-payables", title: "Contas a pagar", header: "Saldo restante", field: "outstandingAmount", columns: 5 },
  { path: "/compras/pedidos", endpoint: "purchase-orders", title: "Pedidos de compra", header: "Valor", field: "amount", columns: 4 },
  { path: "/estoque", endpoint: "stock", title: "Saldos por produto", header: "Disponível", field: "available", columns: 4 },
]
async function fixture(page: Page, endpoint: string, empty = false, canEdit = true) {
  const queries: URLSearchParams[] = []
  await page.route(new RegExp(`/api/erp/${endpoint}\\?`), route => {
    const query = new URL(route.request().url()).searchParams
    queries.push(query)
    // Deliberately return a fixed page. The UI must render the authoritative server order.
    const first = { ...row, status: endpoint === "stock" ? "active" : row.status }
    return route.fulfill({ json: { tenantId: tenant, canEdit, data: empty ? [] : [first, { ...first, id: "33333333-3333-4333-8333-333333333333", productId: "33333333-3333-4333-8333-333333333333", customerName: "Alfa Academia", supplierName: "Alfa Fornecedor", name: "Alfa Equipamento", title: "Projeto Alfa", amount: "2.00", outstandingAmount: "2.00", estimatedCents: 200 }], total: empty ? 0 : 60, totals: [{ stage: "negotiation", count: 60, estimatedCents: 123456989 }] } })
  })
  return queries
}

for (const family of families) test(`${family.title}: server sorting, URL history and empty native headers`, async ({ page }) => {
  const requests = await fixture(page, family.endpoint)
  await page.goto(`${family.path}?offset=25&source=business`)
  const table = page.getByRole("table").first()
  await expect(table.getByRole("columnheader")).toHaveCount(family.columns)
  const header = table.getByRole("columnheader", { name: family.header, exact: true })
  await header.getByRole("button").press("Enter")
  await expect(header).toHaveAttribute("aria-sort", "ascending")
  await expect.poll(() => requests.at(-1)?.get("sortBy")).toBe(family.field)
  expect(requests.at(-1)?.get("offset")).toBe("25")
  await expect(page).toHaveURL(/source=business/)
  await expect(table.getByRole("row").nth(1)).toContainText("Zeta")
  await header.getByRole("button").click()
  await expect(header).toHaveAttribute("aria-sort", "descending")
  await expect.poll(() => requests.at(-1)?.get("sortOrder")).toBe("desc")
  await page.goBack()
  await expect(header).toHaveAttribute("aria-sort", "ascending")
  await page.goForward()
  await expect(header).toHaveAttribute("aria-sort", "descending")
  await page.reload()
  await expect(header).toHaveAttribute("aria-sort", "descending")
  await fixture(page, family.endpoint, true, false)
  await page.reload()
  await expect(page.getByRole("heading", { name: family.title, exact: true, level: 1 })).toHaveCount(1)
  await expect(table.getByRole("columnheader")).toHaveCount(family.columns)
  await expect(table.locator(".workspace-list-empty")).toBeVisible()
  await expect(page.locator('.workspace-entity-list a[href$="/novo"],.workspace-entity-list a[href$="/nova"]')).toHaveCount(0)
})

for (const width of [375, 768, 1024, 1440]) test(`business lists contain horizontal scroll and keep money indivisible at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 })
  for (const family of families) {
    await fixture(page, family.endpoint)
    await page.goto(family.path)
    const table = page.getByRole("table").first()
    await expect(table.getByRole("row").nth(1)).toContainText("Zeta")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const region = table.locator("..")
    expect(await region.evaluate(node => getComputedStyle(node).overflowX === "auto")).toBe(true)
    const cells = table.locator(".workspace-currency-cell")
    expect(await cells.evaluateAll(nodes => nodes.every(node => getComputedStyle(node).whiteSpace === "nowrap" && getComputedStyle(node).textAlign === "right"))).toBe(true)
    await page.screenshot({ path: info.outputPath(`${family.endpoint}-${width}.png`), fullPage: true })
  }
})

test("proposal filters preserve sort, reset paging, and carry context through detail links", async ({ page }) => {
  const requests = await fixture(page, "proposals")
  await page.goto("/vendas/propostas?q=Academia&status=sent&offset=25&sortBy=amount&sortOrder=desc&source=business")
  await expect(page.getByLabel("Cliente ou número", { exact: true })).toHaveValue("Academia")
  await expect(page.getByLabel("Situação", { exact: true })).toHaveValue("sent")
  const link = page.getByRole("table").getByRole("link", { name: "Zeta Academia", exact: true })
  const target = new URL((await link.getAttribute("href"))!, "https://erp.test")
  expect(new URL(target.searchParams.get("returnTo")!, "https://erp.test").searchParams.get("sortBy")).toBe("amount")
  await page.getByRole("button", { name: "Limpar", exact: true }).click()
  await expect.poll(() => requests.at(-1)?.get("offset")).toBe("0")
  expect(requests.at(-1)?.get("q")).toBe("")
  expect(requests.at(-1)?.get("status")).toBe("")
  expect(requests.at(-1)?.get("sortBy")).toBe("amount")
  await expect(page).toHaveURL(/source=business/)
})

test("sales dashboard keeps independent URL sorts and canonical five-row requests", async ({ page }) => {
  const proposals = await fixture(page, "proposals")
  const orders = await fixture(page, "orders")
  await page.goto("/vendas?source=business")
  const proposalTable = page.getByRole("table", { name: "Propostas recentes", exact: true })
  const orderTable = page.getByRole("table", { name: "Pedidos recentes", exact: true })
  await proposalTable.getByRole("button", { name: "Valor", exact: true }).click()
  await expect.poll(() => proposals.at(-1)?.get("sortBy")).toBe("amount")
  await orderTable.getByRole("button", { name: "Pedido", exact: true }).click()
  await expect.poll(() => orders.at(-1)?.get("sortBy")).toBe("number")
  await expect(page).toHaveURL(/proposalsSortBy=amount/)
  await expect(page).toHaveURL(/ordersSortBy=number/)
  await expect(page).toHaveURL(/source=business/)
  expect(proposals.at(-1)?.get("limit")).toBe("5")
  expect(orders.at(-1)?.get("limit")).toBe("5")
  expect(orders.at(-1)?.has("proposalsSortBy")).toBe(false)
  await page.reload()
  await expect(proposalTable.getByRole("columnheader", { name: "Valor", exact: true })).toHaveAttribute("aria-sort", "ascending")
  await expect(orderTable.getByRole("columnheader", { name: "Pedido", exact: true })).toHaveAttribute("aria-sort", "ascending")
})

for (const family of [
  { list: "/compras/pedidos", detail: "/compras/pedidos", endpoint: "purchase-orders", save: "Salvar rascunho", back: "Voltar às compras" },
  { list: "/compras/recebimentos", detail: "/compras/pedidos", endpoint: "purchase-orders", save: "Salvar rascunho", back: "Voltar às compras" },
  { list: "/vendas/pedidos", detail: "/vendas/pedidos", endpoint: "orders", save: "Salvar rascunho", back: "Pedidos" },
  { list: "/vendas/propostas", detail: "/vendas/propostas", endpoint: "proposals", save: "Salvar proposta", back: "Voltar às propostas" },
]) test(`${family.list}: detail, edit, saved redirect and back retain sorting and pagination`, async ({ page }) => {
  await fixture(page, family.endpoint)
  let writes = 0
  const data = { ...row, customerId: record, supplierId: record, isCurrent: true, orderId: null, customerTaxId: "52998224725", paymentTerms: "À vista", deliveryTerms: "Retirada", notes: "" }
  const items = [{ productId: record, name: "Equipamento preservado", sku: "EQ-10", unit: "UN", quantity: "1.000000", receivedQuantity: "0.000000", unitPrice: "10.00", catalogPrice: "10.00", unitCost: "10.00", amount: "10.00" }]
  await page.route(`**/api/erp/${family.endpoint}/${record}`, route => {
    if (route.request().method() === "PUT") writes++
    return route.fulfill({ headers: { ETag: writes ? '"2"' : '"1"' }, json: { tenantId: tenant, canEdit: true, data, items, versions: [data] } })
  })
  await page.route(`**/api/erp/products/${record}`, route => route.fulfill({ json: { tenantId: tenant, data: { id: record, name: items[0].name, weight: "1.000", hasPhoto: false, structureColors: [], swingArmColors: [], upholsteryConfigurable: false, plateHolderColors: [] } } }))
  await page.route(`**/api/erp/purchase-orders/${record}/receipts?*`, route => route.fulfill({ json: { tenantId: tenant, data: [], total: 0 } }))
  const listUrl = `${family.list}?offset=25&sortBy=amount&sortOrder=desc&source=navigation`
  const backLink = () => family.endpoint === "orders" ? page.getByRole("navigation", { name: "Caminho de navegação", exact: true }).getByRole("link", { name: family.back, exact: true }) : page.getByRole("link", { name: family.back, exact: true })
  await page.goto(listUrl)
  await page.getByRole("table").first().getByRole("row").nth(1).getByRole("link").first().click()
  await expect(backLink()).toHaveAttribute("href", listUrl)
  await backLink().click()
  await expect(page).toHaveURL(new RegExp(`${family.list.replaceAll("/", "\\/")}\\?offset=25`))
  await page.getByRole("table").first().getByRole("row").nth(1).getByRole("link").first().click()
  await page.getByRole("link", { name: "Editar rascunho", exact: true }).click()
  await page.getByRole("button", { name: family.save, exact: true }).click()
  await expect.poll(() => writes).toBe(1)
  await expect.poll(() => new URL(page.url()).pathname).toBe(`${family.detail}/${record}`)
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe(listUrl)
  await expect(backLink()).toHaveAttribute("href", listUrl)
  await backLink().click()
  await expect(page.getByRole("table").first().getByRole("columnheader", { name: "Valor", exact: true })).toHaveAttribute("aria-sort", "descending")
  expect(new URL(page.url()).searchParams.get("offset")).toBe("25")
  expect(new URL(page.url()).searchParams.get("source")).toBe("navigation")
})

test("proposal status applies the current search draft immediately and enables Clear", async ({ page }) => {
  const requests = await fixture(page, "proposals")
  await page.goto("/vendas/propostas?offset=25&sortBy=amount&sortOrder=desc")
  await expect(page.getByRole("button", { name: "Limpar", exact: true })).toBeDisabled()
  await page.getByLabel("Cliente ou número", { exact: true }).fill("Academia no formulário")
  await page.getByLabel("Situação", { exact: true }).selectOption("sent")
  await expect.poll(() => requests.at(-1)?.get("status")).toBe("sent")
  expect(requests.at(-1)?.get("q")).toBe("Academia no formulário")
  expect(requests.at(-1)?.get("offset")).toBe("0")
  expect(requests.at(-1)?.get("sortBy")).toBe("amount")
  await expect(page.getByRole("button", { name: "Limpar", exact: true })).toBeEnabled()
  await page.getByRole("button", { name: "Limpar", exact: true }).click()
  await expect(page.getByLabel("Cliente ou número", { exact: true })).toHaveValue("")
  await expect(page.getByLabel("Situação", { exact: true })).toHaveValue("")
})

test("stock sorting preserves the selected product, dirty draft and uncertain idempotent movement", async ({ page }) => {
  await fixture(page, "stock")
  await page.route(/\/api\/erp\/stock\/movements\?/, route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: [], total: 0 } }))
  const writes: { key: string | undefined; body: unknown }[] = []
  await page.route("**/api/erp/stock/movements", route => {
    writes.push({ key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() })
    return writes.length === 1 ? route.abort("failed") : route.fulfill({ json: { balanceAfter: "101.000000" } })
  })
  await page.goto("/estoque")
  await page.getByRole("button", { name: /Zeta Equipamento/ }).click()
  await page.getByLabel("Quantidade (vírgula ou ponto)", { exact: true }).fill("1")
  await page.getByLabel("Motivo", { exact: true }).fill("Conferência de estoque")
  await page.getByRole("table").getByRole("button", { name: "Disponível", exact: true }).click()
  await expect(page.getByLabel("Quantidade (vírgula ou ponto)", { exact: true })).toHaveValue("1")
  await expect(page.getByLabel("Motivo", { exact: true })).toHaveValue("Conferência de estoque")
  await page.getByRole("button", { name: "Confirmar lançamento", exact: true }).click()
  await expect(page.getByRole("button", { name: "Repetir confirmação", exact: true })).toBeVisible()
  await page.getByRole("table").getByRole("button", { name: "Saldo", exact: true }).click()
  await expect(page.getByLabel("Motivo", { exact: true })).toHaveValue("Conferência de estoque")
  await page.getByRole("button", { name: "Repetir confirmação", exact: true }).click()
  await expect.poll(() => writes.length).toBe(2)
  expect(writes[1]).toEqual(writes[0])
  await expect(page.getByText(/Movimento confirmado/)).toBeVisible()
})
