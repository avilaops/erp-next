import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

test.beforeEach(async ({ context }) => installFrontendFixture(context))

test("suprimentos oferece seis destinos operacionais sem prévias", async ({ page }) => {
  await page.goto("/preferencias?categoria=suprimentos")
  const options = page.locator("#preference-options")
  await expect(options.getByRole("link")).toHaveCount(6)
  await expect(options.getByText("Indisponível", { exact: true })).toHaveCount(0)
  await expect(options.getByText("Prévia", { exact: true })).toHaveCount(0)
})

test("estoque salva regras com empresa e revisão e mantém estado ao recarregar", async ({ page }) => {
  let data: unknown = null
  await page.route("**/api/erp/inventory-settings", route => {
    if (route.request().method() === "PUT") {
      expect(route.request().headers()["if-match"]).toBe('"1"')
      expect(route.request().headers()["x-tenant-id"]).toBe(tenant)
      data = route.request().postDataJSON()
    }
    return route.fulfill({ headers: { ETag: data ? '"2"' : '"1"' }, json: { tenantId: tenant, revision: data ? 2 : 1, canEdit: true, data } })
  })
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto("/preferencias/suprimentos/estoque")
  await expect(page.getByLabel("Permitir lançamentos manuais")).toHaveValue("true")
  await page.getByLabel("Permitir lançamentos manuais").selectOption("false")
  await page.getByLabel("Tamanho mínimo do motivo").fill("12")
  await page.getByRole("button", { name: "Salvar configurações", exact: true }).click()
  await expect(page.getByText("Configurações salvas para esta empresa.", { exact: true })).toBeVisible()
  expect(data).toEqual({ allowManualMovements: false, minimumReasonLength: 12 })
  await page.reload()
  await expect(page.getByLabel("Tamanho mínimo do motivo")).toHaveValue("12")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("compras exige campos válidos e preserva edição em conflito", async ({ page }) => {
  await page.route("**/api/erp/purchase-settings", route => route.request().method() === "PUT"
    ? route.fulfill({ status: 412, json: { title: "Outra pessoa alterou a configuração" } })
    : route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, revision: 1, canEdit: true, data: null } }))
  await page.goto("/preferencias/suprimentos/compras")
  const save = page.getByRole("button", { name: "Salvar configurações", exact: true })
  await expect(save).toBeDisabled()
  await page.getByLabel("Valor mínimo do pedido").fill("150,00")
  await page.getByLabel("Prazo máximo de pagamento em dias").fill("30")
  await page.getByLabel("Exigir contato do fornecedor").selectOption("true")
  await save.click()
  await expect(page.getByRole("alert").filter({ hasText: "Outra pessoa alterou" })).toBeVisible()
  await expect(page.getByLabel("Valor mínimo do pedido")).toHaveValue("150,00")
  await expect(save).toBeDisabled()
})

test("configurações de consulta não permitem edição", async ({ page }) => {
  await page.route("**/api/erp/inventory-settings", route => route.fulfill({ headers: { ETag: '"2"' }, json: { tenantId: tenant, revision: 2, canEdit: false, data: { allowManualMovements: true, minimumReasonLength: 3 } } }))
  await page.goto("/preferencias/suprimentos/estoque")
  await expect(page.getByLabel("Permitir lançamentos manuais")).toBeDisabled()
  await expect(page.getByRole("button", { name: "Salvar configurações", exact: true })).toBeDisabled()
})

test("listagem permite limpar a busca e mantém a tabela acessível no celular", async ({ page }, testInfo) => {
  await page.route("**/api/erp/warehouses**", route => {
    const query = new URL(route.request().url()).searchParams
    const data = query.get("q") ? [] : [{ id: record, revision: 1, code: "DEP-01", name: "Depósito principal", status: "active", notes: null, location: "Galpão A" }]
    return route.fulfill({ json: { tenantId: tenant, canEdit: true, data, total: data.length, offset: 0, limit: 25 } })
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/estoque/depositos")
  const table = page.getByRole("table")
  await expect(table.getByRole("link", { name: "Depósito principal", exact: true })).toBeVisible()
  await expect(table.getByRole("link", { name: "Editar Depósito principal", exact: true })).toBeVisible()
  await page.getByRole("textbox", { name: "Buscar nome ou código" }).fill("inexistente")
  await page.getByRole("region", { name: "Depósitos de estoque", exact: true }).getByRole("button", { name: "Buscar", exact: true }).click()
  await expect(page.getByText("Nenhum cadastro encontrado. Revise os filtros ou adicione um registro.", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Limpar", exact: true }).click()
  await expect(table.getByRole("cell", { name: "Galpão A", exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("depositos-desktop.png"), fullPage: true })
  await page.setViewportSize({ width: 320, height: 844 })
  await expect(table).toBeVisible()
  await expect(table.getByRole("link", { name: "Depósito principal", exact: true })).toBeVisible()
  const list = page.getByRole("region", { name: "Lista de Depósitos de estoque", exact: true })
  expect(await list.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  const mobileName = table.locator('th[scope="row"]')
  await expect(mobileName.getByText("Galpão A", { exact: true })).toBeVisible()
  await expect(mobileName.getByText("DEP-01", { exact: true })).toBeVisible()
  await expect(table.getByRole("link", { name: "Editar Depósito principal", exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath("depositos-mobile.png"), fullPage: true })
})

for (const config of [
  { path: "/estoque/depositos", endpoint: "warehouses", extra: { location: "Galpão A" } },
  { path: "/cadastros/grupos-produtos", endpoint: "product-groups", extra: {} },
  { path: "/cadastros/grupos-tags", endpoint: "tag-groups", extra: {} },
  { path: "/cadastros/tags", endpoint: "tags", extra: { groupId: null } },
]) {
  test(`${config.endpoint}: cria, consulta, edita e arquiva sem dados demonstrativos`, async ({ page }) => {
    let data = { id: record, revision: 1, code: "CAD-01", name: "Cadastro de suprimentos", status: "active", notes: null, ...config.extra }
    let created = false
    await page.route(`**/api/erp/${config.endpoint}**`, route => {
      const request = route.request()
      if (["POST", "PUT"].includes(request.method())) {
        expect(request.headers()["x-tenant-id"]).toBe(tenant)
        expect(request.headers()["idempotency-key"]).toBeTruthy()
        if (request.method() === "PUT") expect(request.headers()["if-match"]).toBe('"1"')
        data = { ...data, ...request.postDataJSON(), revision: request.method() === "PUT" ? 2 : 1 }
        created = true
      }
      const detail = new URL(request.url()).pathname.endsWith(record) || request.method() === "POST"
      return route.fulfill({ headers: { ETag: `"${data.revision}"` }, json: detail ? { tenantId: tenant, canEdit: true, data } : { tenantId: tenant, canEdit: true, data: created ? [data] : [], total: created ? 1 : 0, offset: 0, limit: 25 } })
    })
    if (config.endpoint === "tags") await page.route("**/api/erp/tag-groups**", route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: [], total: 0, offset: 0, limit: 10 } }))
    await page.setViewportSize({ width: 375, height: 844 })
    await page.goto(config.path)
    await expect(page.getByText("Nenhum cadastro encontrado. Revise os filtros ou adicione um registro.", { exact: true })).toBeVisible()
    await page.getByRole("link", { name: "Novo cadastro", exact: true }).click()
    await page.getByLabel("Código", { exact: true }).fill("CAD-01")
    await page.getByLabel("Nome", { exact: true }).fill("Cadastro de suprimentos")
    if (config.endpoint === "warehouses") await page.getByLabel("Localização", { exact: true }).fill("Galpão A")
    await page.getByRole("button", { name: "Salvar cadastro", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Cadastro de suprimentos", exact: true })).toBeVisible({ timeout: 30_000 })
    await page.getByRole("link", { name: "Editar cadastro", exact: true }).click()
    await page.getByRole("combobox", { name: "Situação", exact: true }).selectOption("archived")
    await page.getByRole("button", { name: "Salvar cadastro", exact: true }).click()
    await expect(page.locator("dd").filter({ hasText: /^Arquivado$/ })).toBeVisible()
    expect(data.status).toBe("archived")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
