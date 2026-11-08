import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

test("lista própria salva preço manual e permite consultar e editar sem publicar tabela", async ({ context, page }) => {
  await installFrontendFixture(context)
  let saved: Record<string, unknown> | null = null
  await page.route("**/api/erp/price-lists**", route => {
    const request = route.request()
    if (request.method() !== "GET") {
      saved = request.postDataJSON()
      return route.fulfill({ status: request.method() === "POST" ? 201 : 200, headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: { ...saved, id: record, revision: 1, itemCount: 1, items: [{ productId: record, name: "Produto de teste", sku: "P-1", unit: "UN", price: "90.50" }] } } })
    }
    return route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: new URL(request.url()).pathname.endsWith(record) ? { ...saved, id: record, revision: 1, items: [{ productId: record, name: "Produto de teste", sku: "P-1", unit: "UN", price: "90.50" }] } : [], total: 0 } })
  })
  await page.route("**/api/erp/products?*", route => route.fulfill({ json: { tenantId: tenant, total: 1, data: [{ id: record, name: "Produto de teste", sku: "P-1", unit: "UN", basePrice: "100.00" }] } }))
  await page.goto("/cadastros/listas-precos")
  await expect(page.getByRole("heading", { name: "Listas de preços", exact: true })).toBeVisible()
  await page.getByRole("link", { name: "Nova lista", exact: true }).click()
  await page.getByLabel("Código", { exact: true }).fill("VAREJO")
  await page.getByLabel("Nome da lista", { exact: true }).fill("Varejo")
  await page.getByLabel("Buscar produto", { exact: true }).fill("Produto")
  await page.getByRole("button", { name: "Selecionar Produto de teste · P-1", exact: true }).click()
  await page.getByLabel("Preço de Produto de teste", { exact: true }).fill("90,50")
  await page.getByRole("button", { name: "Salvar lista", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/cadastros/listas-precos/${record}$`))
  expect(saved).toMatchObject({ code: "VAREJO", name: "Varejo", items: [{ productId: record, price: "90.50" }] })
  await expect(page.getByRole("table", { name: "Produtos da lista", exact: true })).toContainText("90,50")
  await expect(page.getByRole("button", { name: "Preparar prévia", exact: true })).toHaveCount(0)
  await page.getByRole("link", { name: "Editar lista", exact: true }).click()
  await expect(page.getByLabel("Nome da lista", { exact: true })).toHaveValue("Varejo")
})
