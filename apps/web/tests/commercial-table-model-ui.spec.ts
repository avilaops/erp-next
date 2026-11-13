import { expect, test, type Page } from "@playwright/test"
import { installFrontendFixture, tenant } from "./helpers/frontend-fixture"

const first = "33333333-3333-4333-8333-333333333333"
const second = "44444444-4444-4444-8444-444444444444"
const version = "55555555-5555-4555-8555-555555555555"
const equipment = [
  { productId: first, sku: "UI-001", name: "Equipamento Alfa", unit: "UN", priceWithoutIpiCents: 30001, priceWithIpiCents: 33902, ipiBps: 1300, available: true, unavailableReason: null, freeDiscountPriceWithIpiCents: 27122, maxOwnDiscountBps: 2450, minOwnPriceWithIpiCents: 25600 },
  { productId: second, sku: "UI-002", name: "Equipamento Beta", unit: "UN", priceWithoutIpiCents: 50003, priceWithIpiCents: 56504, ipiBps: 1300, available: true, unavailableReason: null, freeDiscountPriceWithIpiCents: 45203, maxOwnDiscountBps: 2300, minOwnPriceWithIpiCents: 43500 },
]

async function fixture(page: Page, options: { unavailable?: boolean; canCreate?: boolean; items?: typeof equipment } = {}) {
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
        items: (options.items || equipment).map(item => options.unavailable ? { ...item, available: false, unavailableReason: "Publicação desatualizada", freeDiscountPriceWithIpiCents: null, maxOwnDiscountBps: null, minOwnPriceWithIpiCents: null } : item),
      },
    } })
  })
}

test.beforeEach(async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  await fixture(page)
})

test("paginação imediata respeita a última página e aguarda o filtro atual", async ({ page }, info) => {
  await fixture(page, { items: Array.from({ length: 17 }, (_, index) => ({ ...equipment[0], productId: index === 0 ? first : `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`, name: index === 0 ? "Único equipamento" : `Equipamento ${index + 1}` })) })
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto(`/vendas/tabela-precos?destinationState=MG&taxpayer=true&itens=${first}:2`)
  const pagination = page.getByRole("navigation", { name: "Paginação da tabela", exact: true })
  await expect(pagination).toContainText("1 a 14 de 17")
  const urls = await page.getByRole("button", { name: "Próxima", exact: true }).evaluate((button: HTMLButtonElement) => {
    button.click()
    const first = window.location.href
    button.click()
    return [first, window.location.href]
  })
  await info.attach("commercial-pagination-history", { body: JSON.stringify(urls, null, 2), contentType: "application/json" })
  for (const url of urls) expect(new URL(url).searchParams.get("offset")).toBe("14")
  await expect(pagination).toContainText("15 a 17 de 17")
  await expect(page.getByRole("button", { name: "Próxima", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Anterior", exact: true }).click()
  await expect(pagination).toContainText("1 a 14 de 17")
  await page.evaluate(() => {
    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!
    const next = Array.from(document.querySelectorAll("button")).find(button => button.textContent?.trim() === "Próxima")!
    search.value = "Único"
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    next.click()
  })
  await expect(pagination).toContainText("1 a 1 de 1")
  await expect(page.getByRole("button", { name: "Próxima", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Anterior", exact: true })).toBeDisabled()
  const final = new URL(page.url()).searchParams
  expect(final.has("offset")).toBe(false)
  expect(final.get("q")).toBe("Único")
  expect(final.get("destinationState")).toBe("MG")
  expect(final.get("taxpayer")).toBe("true")
  expect(final.get("itens")).toBe(`${first}:2`)
})

test("busca imediata preserva IE, destino e carrinho antes da próxima renderização", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto(`/vendas/tabela-precos?destinationState=MG&itens=${first}:2,${second}:1`)
  await expect(page.getByRole("link", { name: "Abrir pedido (3 un.)", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Sem IE", exact: true })).toHaveAttribute("aria-pressed", "true")
  const history = await page.evaluate(() => {
    const urls: string[] = []
    const original = window.history.pushState
    window.history.pushState = function (data, unused, url) {
      original.call(this, data, unused, url)
      urls.push(window.location.href)
    }
    try {
      const search = document.querySelector<HTMLInputElement>('input[type="search"]')!
      const button = Array.from(document.querySelectorAll("button")).find(element => element.textContent?.trim() === "Com IE")!
      // History changes synchronously; Next's useSearchParams update is a transition.
      // Exercise the next user action before that transition can commit.
      button.click()
      search.value = "Beta"
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      return urls
    } finally { window.history.pushState = original }
  })
  await info.attach("commercial-table-history", { body: JSON.stringify(history, null, 2), contentType: "application/json" })
  expect(history).toHaveLength(2)
  expect(new URL(history[0]).searchParams.get("taxpayer")).toBe("true")
  const searched = new URL(history[1]).searchParams
  expect(searched.get("taxpayer")).toBe("true")
  expect(searched.get("destinationState")).toBe("MG")
  expect(searched.get("itens")).toBe(`${first}:2,${second}:1`)
  expect(searched.get("q")).toBe("Beta")
  await page.reload()
  await expect(page.getByRole("button", { name: "Com IE", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByLabel("Buscar equipamento por nome ou código", { exact: true })).toHaveValue("Beta")
  await page.getByText("Sua alçada de desconto por destino", { exact: true }).click()
  await expect(page.getByRole("button", { name: /MG.*31%/ })).toBeVisible()
  const href = await page.getByRole("link", { name: "Abrir pedido (3 un.)", exact: true }).getAttribute("href")
  const simulator = new URL(href!, "https://erp.local")
  expect(simulator.searchParams.get("taxpayer")).toBe("true")
  expect(simulator.searchParams.get("destinationState")).toBe("MG")
  expect(simulator.searchParams.get("itens")).toBe(`${first}:2,${second}:1`)
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
