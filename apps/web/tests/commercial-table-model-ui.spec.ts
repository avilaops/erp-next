import { expect, test, type Page } from "@playwright/test"
import { installFrontendFixture, tenant } from "./helpers/frontend-fixture"

const first = "33333333-3333-4333-8333-333333333333"
const second = "44444444-4444-4444-8444-444444444444"
const version = "55555555-5555-4555-8555-555555555555"
const equipment = [
  { productId: first, sku: "UI-001", name: "Equipamento Alfa", unit: "UN", priceWithoutIpiCents: 30001, priceWithIpiCents: 33902, ipiBps: 1300, available: true, unavailableReason: null, freeDiscountPriceWithIpiCents: 27122, maxOwnDiscountBps: 2450, minOwnPriceWithIpiCents: 25600 },
  { productId: second, sku: "UI-002", name: "Equipamento Beta", unit: "UN", priceWithoutIpiCents: 50003, priceWithIpiCents: 56504, ipiBps: 1300, available: true, unavailableReason: null, freeDiscountPriceWithIpiCents: 45203, maxOwnDiscountBps: 2300, minOwnPriceWithIpiCents: 43500 },
]

async function fixture(page: Page, options: { unavailable?: boolean; canCreate?: boolean } = {}) {
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["sales.orders.read", ...(options.canCreate === false ? [] : ["sales.orders.manage"])] } }))
  await page.route(/\/api\/erp\/commercial\/tables\/(imported|national)(\?.*)?$/, route => {
    const url = new URL(route.request().url())
    const destinationState = url.searchParams.get("destinationState") || "SP"
    const taxpayer = url.searchParams.get("taxpayer") === "true"
    return route.fulfill({ json: {
      tenantId: tenant, line: url.pathname.endsWith("national") ? "national" : "imported", canManage: false, authority: "managerTarget", canCreateOrder: options.canCreate !== false, paymentMethods: [],
      data: { id: version, version: 9, publishedAt: "2026-11-11T12:00:00Z", originState: "SP", freeDiscountBps: 2000, minimumDownPaymentBps: 7000,
        context: { destinationState, taxpayer, quantity: 1, freightCents: 0, downPayment: "policy" },
        availability: { status: options.unavailable ? "settingsStale" : "ready", message: options.unavailable ? "Publique os parâmetros atualizados para negociar." : null },
        destinations: [{ state: "SP", taxpayer: false, maxOwnDiscountBps: 2300 }, { state: "MG", taxpayer: false, maxOwnDiscountBps: 2400 }, { state: "MG", taxpayer: true, maxOwnDiscountBps: 3100 }],
        items: equipment.map(item => options.unavailable ? { ...item, available: false, unavailableReason: "Publicação desatualizada", freeDiscountPriceWithIpiCents: null, maxOwnDiscountBps: null, minOwnPriceWithIpiCents: null } : item),
      },
    } })
  })
}

test.beforeEach(async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  await fixture(page)
})

for (const width of [320, 390, 430, 1366, 1440]) test(`tabela por destino conserva carrinho na URL em ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 })
  let writes = 0
  page.on("request", request => { if (request.method() !== "GET" && request.url().includes("/api/erp/commercial/")) writes++ })
  await page.goto("/vendas/tabela-precos")
  const alfa = page.getByRole("row").filter({ hasText: "Equipamento Alfa" })
  await expect(alfa).toContainText("R$ 339,02")
  await expect(alfa).toContainText("R$ 271,22")
  await expect(alfa).toContainText("24,5%")
  await expect(alfa).toContainText("R$ 256,00")
  await alfa.getByRole("button", { name: "+ Pedido", exact: true }).click()
  await alfa.getByRole("button", { name: "+ Pedido", exact: true }).click()
  const beta = page.getByRole("row").filter({ hasText: "Equipamento Beta" })
  await beta.getByRole("button", { name: "+ Pedido", exact: true }).click()
  await expect(page.getByRole("link", { name: "Abrir pedido (3 un.)", exact: true })).toBeVisible()
  await page.getByLabel("Destino (UF)", { exact: true }).selectOption("MG")
  await page.getByRole("button", { name: "Com IE", exact: true }).click()
  await expect(page).toHaveURL(/destinationState=MG/)
  await expect(page).toHaveURL(/taxpayer=true/)
  await page.getByLabel("Buscar equipamento por nome ou código", { exact: true }).fill("Beta")
  await page.getByLabel("Buscar equipamento por nome ou código", { exact: true }).press("Enter")
  await page.reload()
  await expect(page.getByRole("link", { name: "Abrir pedido (3 un.)", exact: true })).toBeVisible()
  await page.getByText("Sua alçada de desconto por destino", { exact: true }).click()
  await expect(page.getByRole("button", { name: /MG.*31%/ })).toBeVisible()
  const href = await page.getByRole("link", { name: "Abrir pedido (3 un.)", exact: true }).getAttribute("href")
  const simulator = new URL(href!, "https://erp.local")
  expect(simulator.searchParams.get("itens")).toBe(`${first}:2,${second}:1`)
  expect(simulator.searchParams.get("destinationState")).toBe("MG")
  expect(simulator.searchParams.get("taxpayer")).toBe("true")
  const returnTo = simulator.searchParams.get("returnTo")!
  await page.goto(returnTo)
  await expect(page.getByLabel("Buscar equipamento por nome ou código", { exact: true })).toHaveValue("Beta")
  await expect(page.getByRole("link", { name: "Abrir pedido (3 un.)", exact: true })).toBeVisible()
  expect(writes).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`commercial-table-${width}.png`), fullPage: true })
})

test("indisponibilidade preserva preços publicados e não inventa limites", async ({ page }) => {
  await fixture(page, { unavailable: true })
  await page.goto("/vendas/tabela-precos")
  await expect(page.getByRole("status").filter({ hasText: "Publique os parâmetros atualizados" })).toBeVisible()
  const alfa = page.getByRole("row").filter({ hasText: "Equipamento Alfa" })
  await expect(alfa).toContainText("R$ 339,02")
  await expect(alfa).toContainText("Indisponível")
  await expect(alfa.getByRole("button", { name: "+ Pedido", exact: true })).toBeDisabled()
  await expect(alfa).not.toContainText("R$ 0,00")
})

test("leitura não concede adição de pedido e permite simulação individual", async ({ page }) => {
  await fixture(page, { canCreate: false })
  await page.goto("/vendas/tabela-precos")
  const alfa = page.getByRole("row").filter({ hasText: "Equipamento Alfa" })
  await expect(alfa.getByRole("button", { name: "+ Pedido", exact: true })).toBeDisabled()
  await expect(alfa.getByRole("link", { name: "Simular pedido", exact: true })).toHaveAttribute("href", new RegExp(`produto=${first}`))
})
