import { expect, test } from "@playwright/test"
import { installFrontendFixture } from "./helpers/frontend-fixture"

test.beforeEach(async ({ context }) => installFrontendFixture(context))

test("página inicial limpa mostra só título e atalhos no desktop e celular", async ({ page }, info) => {
  await page.goto("/")
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 })
    const main = page.locator("main")
    await expect(main.getByRole("heading")).toHaveText(["Visão geral"])
    const shortcuts = main.getByRole("navigation", { name: "Atalhos", exact: true })
    await expect(shortcuts.getByRole("link")).toHaveCount(3)
    await expect(shortcuts.getByRole("link", { name: "Novo pedido", exact: true })).toHaveAttribute("href", "/vendas/pedidos/novo")
    await expect(shortcuts.getByRole("link", { name: "Consultar estoque", exact: true })).toHaveAttribute("href", "/estoque")
    await expect(shortcuts.getByRole("link", { name: "Documentos fiscais", exact: true })).toHaveAttribute("href", "/fiscal")
    await expect(main.getByRole("button")).toHaveCount(0)
    await expect(main.getByRole("status")).toHaveCount(0)
    await expect(main.getByText("Carregando sua página inicial…")).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`home-clean-${width}.png`), fullPage: true })
  }
})

test("início não consulta indicadores ou preferências de personalização", async ({ page }) => {
  const requests: string[] = []
  page.on("request", request => { if (/\/api\/erp\/(preferences|orders|products|audit|receivables|payables)(?:[?/]|$)/.test(request.url())) requests.push(request.url()) })
  await page.goto("/")
  await expect(page.getByRole("navigation", { name: "Atalhos", exact: true })).toBeVisible()
  expect(requests).toEqual([])
})
