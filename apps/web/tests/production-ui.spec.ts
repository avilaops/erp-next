import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

const job = "55555555-5555-4555-8555-555555555555"
const stage = "66666666-6666-4666-8666-666666666666"
const component = "77777777-7777-4777-8777-777777777777"
const permissions = ["production.read", "production.manage", "inventory.stock.read", "inventory.stock.manage"]

test.beforeEach(async ({ context }) => installFrontendFixture(context))

for (const failure of ["resposta perdida", "confirmação inválida"]) {
test(`produção mostra snapshots reais e repete consumo sem duplicar comando após ${failure}`, async ({ page }) => {
  const calls: { key: string; revision: string; body: unknown }[] = []
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions } }))
  await page.route("**/api/erp/production/stages", route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: [{ id: stage, name: "Corte", kind: "andamento", position: 1, revision: 1 }] } }))
  await page.route("**/api/erp/production/orders*", route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: [{ id: job, orderId: record, productId: component, sku: "EQ-01", name: "Equipamento real", unit: "UN", quantity: "2.000000", stageId: stage, stageName: "Corte", stageKind: "andamento", status: "open", revision: 1 }], total: 1 } }))
  await page.route(`**/api/erp/production/orders/${job}`, route => route.fulfill({ headers: { ETag: calls.length ? '"2"' : '"1"' }, json: { tenantId: tenant, canEdit: true, canConsume: true, data: { id: job, orderId: record, productId: record, sku: "EQ-01", name: "Equipamento real", unit: "UN", quantity: "2.000000", stageId: stage, stageName: "Corte", stageKind: "andamento", status: "open", revision: calls.length ? 2 : 1 }, history: [], consumptions: [] } }))
  await page.route("**/api/erp/stock?*", route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: [{ productId: component, name: "Chapa de aço", sku: "MP-01", unit: "KG", status: "active", available: "5.000000" }], total: 1 } }))
  await page.route(`**/api/erp/production/orders/${job}/consumptions`, route => {
    calls.push({ key: route.request().headers()["idempotency-key"], revision: route.request().headers()["if-match"], body: route.request().postDataJSON() })
    return calls.length === 1 ? failure === "resposta perdida" ? route.abort("failed") : route.fulfill({ headers: { ETag: '"2"' }, json: { tenantId: record, data: { id: job, revision: 2 } } }) : route.fulfill({ headers: { ETag: '"2"' }, json: { tenantId: tenant, data: { id: job, revision: 2 } } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/estoque/ordens-producao")
  await page.getByRole("button", { name: "Consultar Equipamento real", exact: true }).click()
  await page.getByRole("combobox", { name: "Componente do estoque", exact: true }).selectOption(component)
  await page.getByLabel("Quantidade consumida", { exact: true }).fill("1,25")
  await page.getByLabel("Custo unitário declarado", { exact: true }).fill("2,10")
  await page.getByLabel("Motivo do consumo", { exact: true }).fill("Consumo conferido na fábrica")
  await page.getByRole("button", { name: "Registrar consumo", exact: true }).click()
  await expect(page.getByLabel("Quantidade consumida", { exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Repetir confirmação", exact: true }).click()
  await expect(page.getByText("Operação confirmada.", { exact: true })).toBeVisible()
  expect(calls).toHaveLength(2)
  expect(calls[0]).toEqual(calls[1])
  expect(calls[0]).toMatchObject({ revision: '"1"', body: { productId: component, quantity: "1.250000", unitCost: "2.10", reason: "Consumo conferido na fábrica" } })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
}

test("produção recusa acesso e oferece recarregar em falha real", async ({ page }) => {
  await page.route("**/api/erp/production/**", route => route.fulfill({ status: 403, json: { title: "Acesso à produção restrito" } }))
  await page.goto("/estoque/ordens-producao")
  await expect(page.getByRole("alert").filter({ hasText: "Acesso à produção restrito" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Tentar novamente", exact: true })).toBeVisible()
})
