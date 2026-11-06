import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant } from "./helpers/frontend-fixture"

const product = "33333333-3333-4333-8333-333333333333"
const version = "55555555-5555-4555-8555-555555555555"
const customer = "44444444-4444-4444-8444-444444444444"
const equipment = { productId: product, sku: "LD-TEST", name: "Equipamento de teste", unit: "UN", priceWithoutIpiCents: 20000, priceWithIpiCents: 22600, structureColors: ["Preto"], plateHolderColors: ["Preto"], plateHolderTypes: ["Olímpico", "Standard"], upholsteryColors: [] }
const table = { id: version, version: 6, publishedAt: "2026-10-14T12:00:00Z", originState: "SP", freeDiscountBps: 2000, minimumDownPaymentBps: 7000, items: [equipment] }
const sale = { calculatorVersion: "fixture", items: [{ productId: product, sku: equipment.sku, name: equipment.name, quantity: 1, tableUnitCents: 20000, netCents: 20000, ipiCents: 2600, totalCents: 22600 }], tableTotalCents: 20000, discountCents: 0, discountBps: 0, netSaleCents: 20000, ipiBps: 1300, ipiCents: 2600, totalCents: 22600, freeDiscountBps: 2000, minimumDownPaymentBps: 7000, minimumDownPaymentCents: 15820, downPaymentCents: 15820, freightCents: 0, approvalReasons: [] }
const director = { band: "atTarget", targetBps: 1500, taxBps: 0, taxesCents: 0, difalBps: 0, difalCents: 0, equipmentCostCents: 5000, fixedFeeCents: 0, profitBeforeIncomeTaxCents: 8550, incomeTaxCents: 2907, netProfitCents: 5643, netProfitBps: 2821, supplierPaymentCents: 7000, targetProfitCents: 3000, downPaymentCommissionCents: 180, requiredDownPaymentCents: 10180, requiredDownPaymentBps: 4505, minimumAtTargetCents: 15820, maximumAtTargetDiscountBps: 1500, maximumNoLossDiscountBps: 5000 }

test.beforeEach(async ({ context, page }) => {
  await installFrontendFixture(context)
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["sales.orders.read", "sales.orders.manage"] } }))
})
for (const viewport of [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
]) test(`simula sem custos privados e invalida resultado após editar em ${viewport.width}x${viewport.height}`, async ({ page }) => {
  await page.setViewportSize(viewport)
  await page.route(/\/api\/erp\/commercial\/tables\/imported(?:\?.*)?$/, route => route.fulfill({ json: { tenantId: tenant, line: "imported", canManage: false, data: table } }))
  let sent: Record<string, unknown> | undefined
  await page.route("**/api/erp/commercial/simulate", route => {
    sent = route.request().postDataJSON()
    return route.fulfill({ json: { tenantId: tenant, version: 6, digest: "a".repeat(64), sale, director: null } })
  })
  await page.route(`**/api/erp/products/${product}`, route => route.fulfill({ json: { tenantId: tenant, data: { structureColors: ["Preto"], upholsteryColors: [] } } }))
  await page.route(/\/api\/erp\/parties\?/, route => route.fulfill({ json: { tenantId: tenant, data: [], total: 0 } }))
  await page.goto("/vendas/simulador")
  await page.getByRole("combobox", { name: "Equipamento da tabela", exact: true }).selectOption(product)
  await page.getByRole("button", { name: "Adicionar", exact: true }).click()
  await page.getByRole("combobox", { name: "Inscrição estadual", exact: true }).selectOption("false")
  await page.getByRole("button", { name: "Simular", exact: true }).click()
  await expect(page.getByRole("region", { name: "Resultado da simulação" })).toContainText("R$ 226,00")
  expect(sent).toEqual({ line: "imported", versionId: version, destinationState: "SP", taxpayer: false, discount: { kind: "percent", value: 0 }, freightCents: 0, downPaymentCents: null, items: [{ productId: product, quantity: 1, structureColor: null, upholsteryColor: null, plateHolderColor: null, plateHolderType: null }] })
  await expect(page.getByText("Custos e lucro — gestão autorizada")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Criar pedido com estas condições", exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => { window.scrollTo(0, 0) })
  await page.screenshot({ path: test.info().outputPath(`simulador-${viewport.width}x${viewport.height}.png`), fullPage: true })
  await page.getByLabel(`Quantidade de ${equipment.name}`, { exact: true }).fill("3")
  await expect(page.getByRole("region", { name: "Resultado da simulação" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Criar pedido com estas condições", exact: true })).toHaveCount(0)
})
test("gestão vê composição, limites e entrada; comando incerto conserva chave e condições", async ({ page }) => {
  await page.route(/\/api\/erp\/commercial\/tables\/imported(?:\?.*)?$/, route => route.fulfill({ json: { tenantId: tenant, line: "imported", canManage: true, data: table } }))
  await page.route("**/api/erp/commercial/simulate", route => route.fulfill({ json: { tenantId: tenant, version: 6, digest: "a".repeat(64), sale, director } }))
  await page.route(/\/api\/erp\/parties\?/, route => route.fulfill({ json: { tenantId: tenant, data: [{ id: customer, legalName: "Cliente de teste" }], total: 1 } }))
  await page.route(`**/api/erp/products/${product}`, route => route.fulfill({ json: { tenantId: tenant, data: { structureColors: ["Preto"], plateHolderColors: ["Preto"], plateHolderTypes: ["Olímpico", "Standard"], upholsteryColors: [] } } }))
  const commands: { key: string; body: unknown }[] = []
  await page.route("**/api/erp/commercial/orders", route => {
    commands.push({ key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() })
    return route.fulfill({ status: 503, json: { title: "Resultado pendente" } })
  })
  await page.goto("/vendas/simulador")
  await page.getByRole("combobox", { name: "Equipamento da tabela", exact: true }).selectOption(product)
  await page.getByRole("button", { name: "Adicionar", exact: true }).click()
  await page.getByRole("combobox", { name: "Inscrição estadual", exact: true }).selectOption("true")
  await page.getByRole("combobox", { name: "Preencher negociação por", exact: true }).selectOption("total")
  await page.getByLabel("Total que o cliente quer pagar", { exact: true }).fill("226,00")
  await page.getByRole("button", { name: "Simular", exact: true }).click()
  await page.getByText("Custos e lucro — gestão autorizada", { exact: true }).click()
  await expect(page.getByText("Pagamento ao fornecedor / China", { exact: true })).toBeVisible()
  await expect(page.getByText("Desconto máximo sem prejuízo", { exact: true })).toBeVisible()
  await page.getByLabel("Buscar cliente", { exact: true }).fill("Cliente")
  await page.getByRole("button", { name: "Selecionar Cliente de teste", exact: true }).click()
  await page.getByLabel("Vencimento da conta a receber", { exact: true }).fill("2026-12-30")
  await page.getByLabel(`Cor da estrutura de ${equipment.name}`, { exact: true }).selectOption("Preto")
  await page.getByLabel(`Cor dos anilheiros de ${equipment.name}`, { exact: true }).selectOption("Preto")
  await page.getByLabel(`Tipo de anilheiro de ${equipment.name}`, { exact: true }).selectOption("Olímpico")
  await page.getByRole("button", { name: "Criar pedido com estas condições", exact: true }).click()
  await expect(page.getByRole("button", { name: "Conferir criação com o mesmo comando", exact: true })).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Linha comercial", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Conferir criação com o mesmo comando", exact: true }).click()
  expect(commands).toHaveLength(2)
  expect(commands[0]).toEqual(commands[1])
  expect(commands[0].key).toMatch(/^[a-f0-9-]{36}$/)
  expect(commands[0].body).toMatchObject({ customerId: customer, simulation: { items: [{ productId: product, structureColor: "Preto", plateHolderColor: "Preto", plateHolderType: "Olímpico" }], discount: { kind: "total", value: 22600 } }, digest: "a".repeat(64) })
})
test("tabela ausente e falha de acesso não fabricam valores", async ({ page }) => {
  await page.route("**/api/erp/commercial/tables/imported", route => route.fulfill({ json: { tenantId: tenant, line: "imported", canManage: false, data: null } }))
  await page.route("**/api/erp/commercial/tables/national", route => route.fulfill({ status: 403, json: { title: "Sem acesso a vendas" } }))
  await page.goto("/vendas/simulador")
  await expect(page.getByText("Nenhuma tabela publicada nesta linha.", { exact: false })).toBeVisible()
  await expect(page.getByRole("button", { name: "Simular", exact: true })).toHaveCount(0)
  await page.getByRole("combobox", { name: "Linha comercial", exact: true }).selectOption("national")
  await expect(page.getByRole("alert").filter({ hasText: "Sem acesso a vendas" })).toBeVisible()
})

test("aprovação usa revisão do pedido e mantém custo restrito na consulta", async ({ page }) => {
  const orderId = "22222222-2222-4222-8222-222222222222"
  let revision = 1
  let approved = false
  const input = { versionId: version, productId: product, quantity: 1, destination: "SP", taxpayer: false, discount: { kind: "percent", value: 3000 }, freightCents: 0 }
  const snapshot = { tenantId: tenant, line: "imported", versionId: version, version: 6, digest: "a".repeat(64), product: { sku: equipment.sku, name: equipment.name, unit: "UN" }, input, sale: { ...sale, needsApproval: true, approvalReasons: ["discount_above_free"] }, director }
  await page.route(`**/api/erp/orders/${orderId}`, route => route.fulfill({ headers: { ETag: `"${revision}"` }, json: { tenantId: tenant, canEdit: true, pricingOrigin: true, data: { id: orderId, number: "1", customerId: customer, customerName: "Cliente de teste", customerTaxId: "52998224725", dueDate: "2026-12-30", amount: "226.00", status: "draft", revision }, items: [{ productId: product, sku: equipment.sku, name: equipment.name, unit: "UN", quantity: "1.000000", unitPrice: "226.00", amount: "226.00" }] } }))
  await page.route("**/api/erp/sales-settings", route => route.fulfill({ json: { tenantId: tenant, canEdit: false, data: null } }))
  await page.route(`**/api/erp/orders/${orderId}/pricing`, route => route.fulfill({ headers: { ETag: `"${revision}"` }, json: { tenantId: tenant, canApprove: true, data: { snapshot, needsApproval: true, approved } } }))
  await page.route(`**/api/erp/orders/${orderId}/pricing/approve`, route => {
    expect(route.request().headers()["if-match"]).toBe('"1"')
    expect(route.request().headers()["idempotency-key"]).toMatch(/^[a-f0-9-]{36}$/)
    expect(route.request().postDataJSON()).toEqual({ reason: "Negociação revisada" })
    revision += 1; approved = true
    return route.fulfill({ headers: { ETag: '"2"' }, json: { tenantId: tenant, id: orderId, revision, approved } })
  })
  await page.goto(`/vendas/pedidos/${orderId}`)
  await expect(page.getByRole("link", { name: "Editar rascunho", exact: true })).toHaveCount(0)
  await page.getByLabel("Motivo da aprovação", { exact: true }).fill("Negociação revisada")
  await page.getByRole("button", { name: "Aprovar exceção comercial", exact: true }).click()
  await expect(page.getByText("Exceção comercial aprovada pela gestão.", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Aprovar exceção comercial", exact: true })).toHaveCount(0)
})
