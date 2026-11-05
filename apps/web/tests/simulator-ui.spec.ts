import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant } from "./helpers/frontend-fixture"

const product = "33333333-3333-4333-8333-333333333333"
const version = "55555555-5555-4555-8555-555555555555"
const customer = "44444444-4444-4444-8444-444444444444"
const equipment = { productId: product, sku: "LD-TEST", name: "Equipamento de teste", unit: "UN", priceWithoutIpiCents: 20000, priceWithIpiCents: 22600, structureColors: ["Preto"], upholsteryColors: [] }
const table = { id: version, version: 6, publishedAt: "2026-10-14T12:00:00Z", originState: "SP", freeDiscountBps: 2000, minimumDownPaymentBps: 7000, ipiBps: 1300, items: [equipment] }
const sale = { quantity: 1, tableUnitCents: 20000, tableTotalCents: 20000, discountCents: 0, discountBps: 0, unitWithoutIpiCents: 20000, unitWithIpiCents: 22600, netSaleCents: 20000, ipiCents: 2600, ipiBps: 1300, invoiceTotalCents: 22600, minimumDownPaymentBps: 7000, minimumDownPaymentCents: 15820, freeDiscountBps: 2000, freightCents: 0, band: "at_target", needsApproval: false, approvalReasons: [] }
const director = { icmsCents: 3600, pisCofinsCents: 1850, channelCents: 500, provisionsCents: 500, equipmentCostCents: 5000, fixedFeeCents: 0, roundingCents: 0, profitBeforeIncomeTaxCents: 8550, incomeTaxCents: 2907, netProfitCents: 5643, netProfitBps: 2821, targetMarginBps: 1500, atTargetBps: 3000, noLossBps: 5000, minimumTargetUnitWithIpiCents: 15820, supplierPaymentCents: 7000, targetProfitCents: 3000, downPaymentCommissionCents: 180, requiredDownPaymentCents: 10180, requiredDownPaymentBps: 4505 }

test.beforeEach(async ({ context, page }) => {
  await installFrontendFixture(context)
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["sales.orders.read", "sales.orders.manage"] } }))
})
for (const width of [320, 390, 1280]) test(`simula sem custos privados e invalida resultado após editar em ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 })
  await page.route(/\/api\/erp\/sales-simulator\/imported(?:\?.*)?$/, route => route.fulfill({ json: { tenantId: tenant, line: "imported", canCreate: true, versions: [table], data: table } }))
  let sent: Record<string, unknown> | undefined
  await page.route("**/api/erp/sales-simulator/imported/quote", route => {
    sent = route.request().postDataJSON()
    return route.fulfill({ json: { tenantId: tenant, line: "imported", versionId: version, version: 6, digest: "a".repeat(64), product: { sku: equipment.sku, name: equipment.name, unit: "UN" }, input: sent, sale } })
  })
  await page.route(/\/api\/erp\/parties\?/, route => route.fulfill({ json: { tenantId: tenant, data: [], total: 0 } }))
  await page.goto("/vendas/simulador")
  await page.getByRole("combobox", { name: "Equipamento", exact: true }).selectOption(product)
  await page.getByRole("combobox", { name: "Inscrição estadual", exact: true }).selectOption("no")
  await page.getByRole("button", { name: "Simular", exact: true }).click()
  await expect(page.getByRole("region", { name: "Resultado da simulação" })).toContainText("R$ 226,00")
  expect(sent).toEqual({ versionId: version, productId: product, quantity: 1, destination: "SP", taxpayer: false, discount: { kind: "percent", value: 0 }, freightCents: 0 })
  await expect(page.getByText("Custos e lucro — acesso da gestão")).toHaveCount(0)
  await expect(page.getByLabel("Criar pedido da simulação")).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath(`simulador-${width}.png`), fullPage: true })
  await page.getByLabel("Quantidade", { exact: true }).fill("3")
  await expect(page.getByRole("region", { name: "Resultado da simulação" })).toHaveCount(0)
  await expect(page.getByLabel("Criar pedido da simulação")).toHaveCount(0)
})
test("gestão vê composição, limites e entrada; comando incerto conserva chave e condições", async ({ page }) => {
  await page.route(/\/api\/erp\/sales-simulator\/imported(?:\?.*)?$/, route => route.fulfill({ json: { tenantId: tenant, line: "imported", canCreate: true, versions: [table], data: table } }))
  await page.route("**/api/erp/sales-simulator/imported/quote", route => route.fulfill({ json: { tenantId: tenant, line: "imported", versionId: version, version: 6, digest: "a".repeat(64), product: { sku: equipment.sku, name: equipment.name, unit: "UN" }, input: route.request().postDataJSON(), sale, director } }))
  await page.route(/\/api\/erp\/parties\?/, route => route.fulfill({ json: { tenantId: tenant, data: [{ id: customer, legalName: "Cliente de teste" }], total: 1 } }))
  const commands: { key: string; body: unknown }[] = []
  await page.route("**/api/erp/sales-simulator/imported/orders", route => {
    commands.push({ key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() })
    return route.fulfill({ status: 503, json: { title: "Resultado pendente" } })
  })
  await page.goto("/vendas/simulador")
  await page.getByRole("combobox", { name: "Equipamento", exact: true }).selectOption(product)
  await page.getByRole("combobox", { name: "Inscrição estadual", exact: true }).selectOption("yes")
  await page.getByRole("combobox", { name: "Forma de informar o desconto", exact: true }).selectOption("target")
  await page.getByLabel("Cliente quer pagar (total com IPI)", { exact: true }).fill("226,00")
  await page.getByRole("button", { name: "Simular", exact: true }).click()
  await page.getByText("Custos e lucro — acesso da gestão", { exact: true }).click()
  await expect(page.getByText("Pagar na China", { exact: true })).toBeVisible()
  await expect(page.getByText("Desconto máximo sem prejuízo", { exact: true })).toBeVisible()
  await page.getByLabel("Buscar cliente", { exact: true }).fill("Cliente")
  await page.getByRole("button", { name: "Selecionar Cliente de teste", exact: true }).click()
  await page.getByLabel("Vencimento", { exact: true }).fill("2026-12-30")
  await page.getByLabel("Cor da estrutura", { exact: true }).selectOption("Preto")
  await page.getByRole("button", { name: "Criar rascunho com estas condições", exact: true }).click()
  await expect(page.getByRole("button", { name: "Conferir criação do pedido", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Nacional", exact: true })).toBeDisabled()
  await expect(page.getByLabel("Quantidade", { exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Conferir criação do pedido", exact: true }).click()
  expect(commands).toHaveLength(2)
  expect(commands[0]).toEqual(commands[1])
  expect(commands[0].key).toMatch(/^[a-f0-9-]{36}$/)
  expect(commands[0].body).toMatchObject({ customerId: customer, structureColor: "Preto", quote: { discount: { kind: "target", value: 22600 } } })
})
test("tabela ausente e falha de acesso não fabricam valores", async ({ page }) => {
  await page.route("**/api/erp/sales-simulator/imported", route => route.fulfill({ json: { tenantId: tenant, canCreate: false, versions: [], data: null } }))
  await page.route("**/api/erp/sales-simulator/national", route => route.fulfill({ status: 403, json: { title: "Sem acesso a vendas" } }))
  await page.goto("/vendas/simulador")
  await expect(page.getByText("Nenhuma tabela publicada nesta linha.", { exact: false })).toBeVisible()
  await expect(page.getByRole("button", { name: "Simular", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Nacional", exact: true }).click()
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
