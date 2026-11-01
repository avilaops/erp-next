import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant } from "./helpers/frontend-fixture"

test.beforeEach(async ({ context }) => installFrontendFixture(context))

const layout = () => ({
  favoritePaths: ["/vendas/pedidos", "/compras/pedidos"],
  charts: ["Ticket médio", "Valor faturado"],
  period: "6M",
})

test("layout salvo é relido e preserva a preferência de paginação", async ({ page }) => {
  let revision = 3
  let data = { productPageSize: 50, dashboardLayout: layout() }
  await page.route("**/api/erp/preferences", async route => {
    if (route.request().method() === "PUT") {
      expect(route.request().headers()["if-match"]).toBe(`"${revision}"`)
      expect(route.request().headers()["x-tenant-id"]).toBe(tenant)
      data = route.request().postDataJSON()
      revision++
    }
    await route.fulfill({ headers: { ETag: `"${revision}"` }, json: { tenantId: tenant, revision, data } })
  })
  await page.goto("/")
  await expect(page.getByRole("button", { name: "Remover Pedidos de venda", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Remover Pedidos de venda", exact: true }).click()
  await page.getByRole("button", { name: "Salvar página inicial", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Página inicial salva" })).toBeVisible()
  expect(data.productPageSize).toBe(50)
  expect(data.dashboardLayout.favoritePaths).toEqual(["/compras/pedidos"])
  await page.reload()
  await expect(page.getByRole("button", { name: "Recarregar página inicial", exact: true })).toBeEnabled()
  await expect(page.getByRole("button", { name: "Remover Pedidos de venda", exact: true })).toHaveCount(0)
})

test("conflito preserva edição e exige releitura antes de nova gravação", async ({ page }) => {
  let attempts = 0
  await page.route("**/api/erp/preferences", async route => {
    if (route.request().method() === "PUT") {
      attempts++
      return route.fulfill({ status: 412, json: { title: "Preferências alteradas em outra tela" } })
    }
    return route.fulfill({ headers: { ETag: '"2"' }, json: { tenantId: tenant, revision: 2, data: { productPageSize: 25, dashboardLayout: layout() } } })
  })
  await page.goto("/")
  await expect(page.getByRole("button", { name: "Remover Pedidos de venda", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Remover Pedidos de venda", exact: true }).click()
  await page.getByRole("button", { name: "Salvar página inicial", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Preferências alteradas" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Salvar página inicial", exact: true })).toBeDisabled()
  expect(attempts).toBe(1)
  await expect(page.getByRole("button", { name: "Remover Pedidos de venda", exact: true })).toHaveCount(0)
  page.once("dialog", dialog => dialog.accept())
  await page.getByRole("button", { name: "Recarregar página inicial", exact: true }).click()
  await expect(page.getByRole("button", { name: "Remover Pedidos de venda", exact: true })).toBeVisible()
})
