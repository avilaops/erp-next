import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant } from "./helpers/frontend-fixture"

test.beforeEach(async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  await page.route(/\/api\/erp\/(orders|proposals)\?/, route => route.fulfill({ json: { tenantId: tenant, data: [], total: 0, canEdit: true } }))
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["sales.orders.read", "sales.orders.manage"] } }))
  await page.route("**/api/erp/commercial/tables/imported", route => route.fulfill({ json: {
    tenantId: tenant, line: "imported", canManage: false, canCreateOrder: true,
    data: { id: "33333333-3333-4333-8333-333333333333", version: 1, publishedAt: "2026-11-11T12:00:00Z", originState: "SP", freeDiscountBps: 2000, minimumDownPaymentBps: 7000, items: [] },
  } }))
})

for (const width of [320, 390, 430, 1366, 1440]) test(`novo pedido parte da negociação e mantém o catálogo explícito em ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  let writes = 0
  page.on("request", request => { if (request.url().includes("/api/erp/") && request.method() !== "GET") writes++ })
  for (const entry of ["/vendas", "/vendas/pedidos"]) {
    await page.goto(entry)
    const start = page.getByRole("link", { name: "Novo pedido", exact: true })
    await expect(start).toHaveAttribute("href", "/vendas/pedidos/novo")
    await expect(page.getByRole("link", { name: "Pedido pelo catálogo", exact: true })).toHaveAttribute("href", "/vendas/pedidos/novo?modo=catalogo")
    await expect(page.getByRole("link", { name: "Tabela de preços", exact: true })).toHaveAttribute("href", "/vendas/tabela-precos")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await start.focus()
    await page.keyboard.press("Enter")
    await expect(page).toHaveURL(/\/vendas\/pedidos\/novo$/)
    await expect(page.getByRole("heading", { name: "Novo pedido", exact: true })).toBeVisible()
    await expect(page.getByLabel("Buscar equipamento", { exact: true })).toBeVisible()
  }
  expect(writes).toBe(0)
})

test("consulta oferece tabela sem habilitar criação de pedidos", async ({ page }) => {
  await page.route(/\/api\/erp\/(orders|proposals)\?/, route => route.fulfill({ json: { tenantId: tenant, data: [], total: 0, canEdit: false } }))
  for (const entry of ["/vendas", "/vendas/pedidos"]) {
    await page.goto(entry)
    await expect(page.getByRole("link", { name: "Tabela de preços", exact: true })).toBeVisible()
    await expect(page.getByRole("link", { name: "Novo pedido", exact: true })).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Pedido pelo catálogo", exact: true })).toHaveCount(0)
  }
})
