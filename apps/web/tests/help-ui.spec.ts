import { expect, test } from "@playwright/test"
import { installFrontendFixture } from "./helpers/frontend-fixture"

test.beforeEach(async ({ context }) => installFrontendFixture(context))

test("ajuda compila MDX e mantém links para os fluxos reais", async ({ page }) => {
  await page.goto("/ajuda")
  await expect(page.getByRole("heading", { name: "Central de ajuda", exact: true })).toBeVisible()
  await page.getByRole("textbox", { name: "Buscar na ajuda" }).fill("DANFE")
  const article = page.locator("article").filter({ has: page.getByRole("heading", { name: "Fiscal", exact: true }) })
  await article.getByText("Ver orientação", { exact: false }).click()
  await expect(article).toContainText("A emissão permanece bloqueada")
  await expect(article).toContainText("geração de DANFE a partir de XML autorizado")
  await expect(article.getByRole("link", { name: "Monitor fiscal", exact: true })).toHaveAttribute("href", "/fiscal/monitor")
  await page.getByRole("textbox", { name: "Buscar na ajuda" }).fill("sem-correspondencia-402")
  await expect(page.getByRole("status")).toHaveText("Nenhuma orientação encontrada. Tente outro termo.")
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("textbox", { name: "Buscar na ajuda" }).fill("")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("MDX incorpora o formulário operacional sem executar comandos ao abrir a ajuda", async ({ page }) => {
  let writes = 0
  page.on("request", request => { if (request.url().includes("/api/erp/") && request.method() !== "GET") writes++ })
  await page.goto("/ajuda")
  const article = page.locator("article").filter({ has: page.getByRole("heading", { name: "Pedidos e propostas", exact: true }) })
  await article.getByText("Ver orientação", { exact: false }).click()
  expect(writes).toBe(0)
  await article.getByRole("button", { name: "Criar rascunho neste guia", exact: true }).click()
  await expect(article.getByRole("heading", { name: "Novo pedido de venda", exact: true })).toBeVisible()
  await expect(article.getByRole("alert")).toContainText("Operação indisponível")
  expect(writes).toBe(0)
})
