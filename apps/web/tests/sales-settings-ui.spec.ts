import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant } from "./helpers/frontend-fixture"

const settings = { minimumOrderAmount: "100.00", maximumPaymentTermDays: 30, requireCustomerContact: true }
test.beforeEach(async ({ context }) => installFrontendFixture(context))

test("configuração começa vazia, exige escolhas e confirma gravação com revisão e empresa", async ({ page }) => {
  let saved: unknown
  await page.route("**/api/erp/sales-settings", route => {
    if (route.request().method() === "PUT") {
      expect(route.request().headers()["if-match"]).toBe('"1"')
      expect(route.request().headers()["x-tenant-id"]).toBe(tenant)
      saved = route.request().postDataJSON()
    }
    return route.fulfill({ headers: { ETag: saved ? '"2"' : '"1"' }, json: { tenantId: tenant, revision: saved ? 2 : 1, canEdit: true, data: saved || null } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/preferencias/vendas")
  for (const name of ["Valor mínimo do pedido", "Prazo máximo de recebimento em dias", "Exigir contato do cliente"]) {
    await expect(page.getByLabel(name, { exact: true })).toHaveValue("")
  }
  const save = page.getByRole("button", { name: "Salvar configurações de vendas", exact: true })
  await expect(save).toBeDisabled()
  await page.getByLabel("Valor mínimo do pedido", { exact: true }).fill("100,00")
  await page.getByLabel("Prazo máximo de recebimento em dias", { exact: true }).fill("30")
  await expect(save).toBeDisabled()
  await page.getByLabel("Exigir contato do cliente", { exact: true }).selectOption("true")
  await save.click()
  await expect(page.getByText("Configurações de vendas salvas para esta empresa.", { exact: true })).toBeVisible()
  expect(saved).toEqual(settings)
  await page.reload()
  await expect(page.getByLabel("Valor mínimo do pedido", { exact: true })).toHaveValue("100.00")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("conflito preserva o formulário e impede repetição sem recarregar", async ({ page }) => {
  await page.route("**/api/erp/sales-settings", route => route.request().method() === "PUT"
    ? route.fulfill({ status: 412, json: { title: "Outra pessoa alterou a configuração" } })
    : route.fulfill({ headers: { ETag: '"2"' }, json: { tenantId: tenant, revision: 2, canEdit: true, data: settings } }))
  await page.goto("/preferencias/vendas")
  await page.getByLabel("Valor mínimo do pedido", { exact: true }).fill("200,00")
  await page.getByRole("button", { name: "Salvar configurações de vendas", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Outra pessoa alterou" })).toBeVisible()
  await expect(page.getByLabel("Valor mínimo do pedido", { exact: true })).toHaveValue("200,00")
  await expect(page.getByRole("button", { name: "Salvar configurações de vendas", exact: true })).toBeDisabled()
})

test("menu habilita Vendas e configurações respeitam acesso de consulta", async ({ page }) => {
  await page.route("**/api/erp/sales-settings", route => route.fulfill({ headers: { ETag: '"2"' }, json: { tenantId: tenant, revision: 2, canEdit: false, data: settings } }))
  await page.goto("/preferencias?categoria=vendas")
  await page.locator("#preference-options").getByRole("link", { name: "Vendas", exact: true }).click()
  await expect(page.getByLabel("Valor mínimo do pedido", { exact: true })).toHaveValue("100.00")
  await expect(page.getByLabel("Valor mínimo do pedido", { exact: true })).toBeDisabled()
})
