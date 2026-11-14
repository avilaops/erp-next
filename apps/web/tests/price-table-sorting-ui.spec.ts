import { expect, test, type Locator } from "@playwright/test"
import { createServer } from "node:http"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

const productId = (index: number) => `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`
const items = Array.from({ length: 30 }, (_, index) => ({ productId: productId(index), name: `Equipamento ${30 - index} com nome extenso para conferência dos preços e alçadas`, sku: `EQ-${30 - index}`, unit: "UN", priceWithoutIpiCents: (30 - index) * 100, priceWithIpiCents: index === 0 ? 9999999999999 : (30 - index) * 100, ipiBps: 1300, available: true, freeDiscountPriceWithIpiCents: (30 - index) * 90, maxOwnDiscountBps: 2450, minOwnPriceWithIpiCents: index === 0 ? null : (30 - index) * 80 }))
const access = { tenant: { id: tenant }, permissions: ["sales.orders.read", "sales.orders.manage", "catalog.products.read", "catalog.products.manage", "platform.company.read", "platform.company.manage"] }
const upstream = createServer((_request, response) => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(access)) })
test.beforeAll(async () => { await new Promise<void>(resolve => upstream.listen(33944, "127.0.0.1", resolve)) })
test.afterAll(async () => { await new Promise<void>(resolve => upstream.close(() => resolve())) })
test.beforeEach(async ({ context, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  await context.route("**/api/erp/me", route => route.fulfill({ json: access }))
  await context.route(/\/api\/erp\/commercial\/tables\/(imported|national)(\?.*)?$/, route => route.fulfill({ json: { tenantId: tenant, line: "imported", canManage: true, canCreateOrder: true, authority: "managerTarget", data: { id: record, version: 4, publishedAt: "2026-11-12T12:00:00Z", originState: "SP", freeDiscountBps: 2000, context: { destinationState: new URL(route.request().url()).searchParams.get("destinationState") || "SP", taxpayer: false }, items } } }))
  await context.route(/\/api\/erp\/price-tables\/(imported|national)$/, route => route.fulfill({ json: { tenantId: tenant, line: "imported", data: { version: 4, publishedAt: "2026-11-12T12:00:00Z", items } } }))
  await context.route("**/api/erp/price-tables/imported/preview", route => route.fulfill({ headers: { ETag: '"5"' }, json: { tenantId: tenant, line: "imported", revision: 5, digest: "a".repeat(64), items } }))
})

async function assertReadablePrices(region: Locator) {
  await expect(region).toBeVisible()
  const currency = region.locator("td").filter({ hasText: /R\$/ })
  expect(await currency.count()).toBeGreaterThan(0)
  expect(await currency.evaluateAll(cells => cells.every(cell => getComputedStyle(cell).whiteSpace === "nowrap" && getComputedStyle(cell).textAlign === "right"))).toBe(true)
  expect(await region.evaluate(node => getComputedStyle(node).overflowX === "auto" && node.scrollWidth >= node.clientWidth)).toBe(true)
}

for (const width of [375, 768, 1024, 1440]) test(`preços comerciais legíveis com rolagem contida em ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 })
  await page.goto("/vendas/tabela-precos")
  const region = page.getByRole("region", { name: "Preços publicados", exact: true })
  await assertReadablePrices(region)
  for (const name of ["Sem IPI", "Com IPI", "Máx. sua alçada", "Menor preço c/IPI"]) await expect(region.getByRole("columnheader", { name, exact: true })).toBeVisible()
  await expect(region.getByRole("row").nth(1)).toContainText("R$ 99.999.999.999,99")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`commercial-prices-${width}.png`), fullPage: true })
})

test("ordena a coleção comercial completa antes da página e conserva seleção e navegação", async ({ page }) => {
  const requests: string[] = []
  page.on("request", request => { if (request.url().includes("/commercial/tables/")) requests.push(request.url()) })
  await page.goto(`/vendas/tabela-precos?offset=14&destinationState=MG&itens=${productId(0)}:2`)
  const table = page.getByRole("table", { name: "Preços publicados", exact: true })
  await expect(table.getByRole("columnheader", { name: "Equipamento", exact: true })).toHaveAttribute("aria-sort", "none")
  await table.getByRole("button", { name: "Com IPI", exact: true }).click()
  await expect(page).toHaveURL(/offset=14/)
  await expect(table.getByRole("columnheader", { name: "Com IPI", exact: true })).toHaveAttribute("aria-sort", "ascending")
  await expect(table.getByRole("row").nth(1)).toContainText("Equipamento 15 com nome")
  await table.getByRole("button", { name: "Com IPI", exact: true }).press("Enter")
  await expect(table.getByRole("columnheader", { name: "Com IPI", exact: true })).toHaveAttribute("aria-sort", "descending")
  await expect(table.getByRole("row").nth(1)).toContainText("Equipamento 16 com nome")
  await page.getByRole("button", { name: "Nacional", exact: true }).click()
  await page.getByLabel("Destino (UF)", { exact: true }).selectOption("SP")
  await page.getByLabel("Buscar equipamento por nome ou código", { exact: true }).fill("Equipamento 2")
  await page.getByLabel("Buscar equipamento por nome ou código", { exact: true }).press("Enter")
  await expect(page).toHaveURL(/sortBy=priceWithIpiCents/)
  await expect(page).toHaveURL(/sortOrder=desc/)
  await expect(page).toHaveURL(new RegExp(`itens=${productId(0)}%3A2`))
  await page.reload()
  await expect(table.getByRole("columnheader", { name: "Com IPI", exact: true })).toHaveAttribute("aria-sort", "descending")
  const href = await page.getByRole("link", { name: "Abrir pedido (2 un.)", exact: true }).getAttribute("href")
  expect(new URL(new URL(href!, "https://erp.local").searchParams.get("returnTo")!, "https://erp.local").searchParams.get("sortOrder")).toBe("desc")
  expect(requests.every(value => !new URL(value).searchParams.has("sortBy"))).toBe(true)
})

for (const width of [375, 768, 1024, 1440]) test(`publicação e prévia mantêm todos os preços em ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  await page.goto("/preferencias/tabela-precos")
  await assertReadablePrices(page.getByRole("region", { name: "Preços da versão publicada", exact: true }))
  await page.getByRole("button", { name: "Preparar prévia", exact: true }).click()
  const preview = page.getByRole("region", { name: "Preços da prévia", exact: true })
  await assertReadablePrices(preview)
  await preview.getByRole("button", { name: "Com IPI", exact: true }).click()
  await expect(preview.getByRole("row").nth(1)).toContainText("Equipamento 1 com nome")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("listas paginadas enviam ordenação ao servidor e preservam filtros ao consultar e voltar", async ({ page }) => {
  const requests: URL[] = []
  const rows = [{ id: record, code: "Z", name: "Lista Zeta", status: "active", validFrom: null, validUntil: null, itemCount: 3 }, { id: productId(2), code: "A", name: "Lista Alfa", status: "active", validFrom: null, validUntil: null, itemCount: 1 }]
  await page.route("**/api/erp/price-lists?*", route => { requests.push(new URL(route.request().url())); return route.fulfill({ json: { tenantId: tenant, canEdit: true, data: rows, total: 60, offset: 25, limit: 25 } }) })
  await page.route(`**/api/erp/price-lists/${record}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: { ...rows[0], revision: 1, notes: null, items: [] } } }))
  await page.goto("/cadastros/listas-precos?q=Lista&status=active&offset=25&limit=25&source=prices")
  const table = page.getByRole("table", { name: "Listas de preços", exact: true })
  await table.getByRole("button", { name: "Nome", exact: true }).click()
  await expect.poll(() => requests.at(-1)?.searchParams.get("sortBy")).toBe("name")
  expect(requests.at(-1)?.searchParams.get("sortOrder")).toBe("asc")
  for (const [key, value] of [["q", "Lista"], ["status", "active"], ["offset", "25"], ["limit", "25"]]) expect(requests.at(-1)?.searchParams.get(key)).toBe(value)
  await expect(table.getByRole("row").nth(1)).toContainText("Lista Zeta")
  await table.getByRole("link", { name: "Lista Zeta", exact: true }).click()
  await page.getByRole("link", { name: "Voltar às listas", exact: true }).click()
  await expect(page).toHaveURL(/sortBy=name/)
  await expect(page).toHaveURL(/offset=25/)
  await expect(page).toHaveURL(/source=prices/)
  await page.getByRole("button", { name: "Limpar", exact: true }).click()
  await expect(page).toHaveURL(/sortBy=name/)
  await expect.poll(() => requests.at(-1)?.searchParams.get("offset")).toBe("0")
  expect(requests.at(-1)?.searchParams.has("q")).toBe(false)
  expect(requests.at(-1)?.searchParams.has("status")).toBe(false)
})

test("detalhe ordena preços exatos sem alterar a sequência no editor", async ({ page }) => {
  const listItems = ["100.00", "2.00", "10.00"].map((price, index) => ({ productId: productId(index), sku: `EQ-${index}`, name: `Produto ${price}`, unit: "UN", price }))
  await page.route(`**/api/erp/price-lists/${record}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: { id: record, revision: 1, code: "TESTE", name: "Lista de teste", status: "active", validFrom: null, validUntil: null, notes: null, items: listItems } } }))
  await page.goto(`/cadastros/listas-precos/${record}`)
  const table = page.getByRole("table", { name: "Produtos da lista", exact: true })
  await table.getByRole("button", { name: "Preço", exact: true }).click()
  await expect(table.getByRole("row").nth(1)).toContainText("Produto 2.00")
  await expect(table.getByRole("row").nth(2)).toContainText("Produto 10.00")
  await expect(table.getByRole("row").nth(3)).toContainText("Produto 100.00")
  await page.getByRole("link", { name: "Editar lista", exact: true }).click()
  await expect(table.getByRole("row").nth(1)).toContainText("Produto 100.00")
  await expect(table.getByRole("row").nth(2)).toContainText("Produto 2.00")
  await expect(table.getByRole("button", { name: "Preço", exact: true })).toHaveCount(0)
})
