import { expect, test, type Page } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

const product = "33333333-3333-4333-8333-333333333333"
const customer = "44444444-4444-4444-8444-444444444444"
const version = "55555555-5555-4555-8555-555555555555"
const name = "Treino · Remada articulada com apoio de peito"
const equipment = { productId: product, name, sku: "TR-014", unit: "UN", ipiBps: 0, priceWithoutIpiCents: 20000, priceWithIpiCents: 20000 }
const products = Array.from({ length: 16 }, (_, index) => index === 14 ? equipment : { ...equipment, productId: `66666666-6666-4666-8666-${String(index).padStart(12, "0")}`, sku: `TR-${String(index).padStart(3, "0")}`, name: `Treino · Equipamento ${index}` })
const table = { id: version, version: 6, publishedAt: "2026-11-11T12:00:00Z", originState: "SP", freeDiscountBps: 2000, minimumDownPaymentBps: 7000, items: products }
const listing = "/vendas/tabela-precos?linha=national&q=Treino&offset=14"

test.beforeEach(async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["sales.orders.read", "sales.orders.manage", "catalog.parties.read", "catalog.products.read"] } }))
  await page.route(/\/api\/erp\/commercial\/tables\/(imported|national)$/, route => route.fulfill({ json: { tenantId: tenant, line: route.request().url().endsWith("national") ? "national" : "imported", canManage: false, data: table } }))
  await page.route(`**/api/erp/products/${product}`, route => route.fulfill({ json: { tenantId: tenant, data: { id: product, name, sku: equipment.sku, structureColors: ["Preto"], upholsteryColors: [], upholsteryConfigurable: false, hasPhoto: false } } }))
  await page.route(/\/api\/erp\/parties\?/, route => route.fulfill({ json: { tenantId: tenant, total: 1, data: [{ id: customer, legalName: "Academia de teste", taxId: "52998224725" }] } }))
})

function sale(quantity = 1) {
  return { calculatorVersion: "fixture", items: [{ ...equipment, quantity, tableUnitCents: 20000, netCents: 18000 * quantity, ipiCents: 0, totalCents: 18000 * quantity }], tableTotalCents: 20000 * quantity, discountCents: 2000 * quantity, discountBps: 1000, netSaleCents: 18000 * quantity, ipiBps: 0, ipiCents: 0, totalCents: 18000 * quantity, freeDiscountBps: 2000, minimumDownPaymentBps: 7000, minimumDownPaymentCents: 12600 * quantity, downPaymentCents: 12600 * quantity, freightCents: 0, approvalReasons: [] }
}

async function chooseCustomer(page: Page) {
  await page.getByRole("navigation", { name: "Etapas da simulação" }).getByRole("link", { name: "Cliente", exact: true }).click()
  await page.getByLabel("Buscar cliente", { exact: true }).fill("Academia")
  await page.getByRole("button", { name: "Pesquisar cliente", exact: true }).click()
  await page.getByRole("button", { name: "Selecionar Academia de teste", exact: true }).click()
  await page.getByLabel("Vencimento da conta a receber", { exact: true }).fill("2026-12-30")
}

for (const width of [320, 390, 430, 1366, 1440]) test(`tabela nacional até pedido criado preserva negociação e retorno em ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 })
  let sent: Record<string, unknown> | undefined
  await page.route("**/api/erp/commercial/simulate", route => route.fulfill({ json: { tenantId: tenant, version: 6, digest: "a".repeat(64), sale: sale(), director: null } }))
  await page.route("**/api/erp/commercial/orders", route => {
    sent = route.request().postDataJSON()
    expect(route.request().headers()["idempotency-key"]).toMatch(/^[a-f0-9-]{36}$/)
    return route.fulfill({ status: 201, headers: { ETag: '"1"' }, json: { tenantId: tenant, id: record } })
  })
  await page.route(`**/api/erp/orders/${record}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, pricingOrigin: true, data: { id: record, number: "127", status: "draft", revision: 1, customerId: customer, customerName: "Academia de teste", customerTaxId: "52998224725", dueDate: "2026-12-30", amount: "180.00" }, items: [{ productId: product, name, sku: equipment.sku, unit: "UN", quantity: "1.000000", unitPrice: "180.00", amount: "180.00", structureColor: "Preto", upholsteryColor: null, plateHolderType: "Olímpico" }] } }))
  await page.route(`**/api/erp/commercial/orders/${record}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, revision: 1, canApprove: false, approvalStatus: "not_required", decisions: [], director: null, data: { sale: sale(), version: 6, input: { line: "national", destinationState: "SP", taxpayer: false } } } }))
  await page.goto(listing)
  await expect(page.getByRole("button", { name: "Nacional", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByLabel("Buscar equipamento por nome ou código", { exact: true })).toHaveValue("Treino")
  await expect(page.getByRole("navigation", { name: "Paginação da tabela" })).toContainText("15 a 16 de 16")
  const row = page.getByRole("row").filter({ hasText: name })
  await row.getByRole("link", { name: "Simular pedido", exact: true }).click()
  await expect(page.getByLabel(`Quantidade de ${name}`, { exact: true })).toHaveValue("1")
  const back = page.getByRole("link", { name: "Tabela de preços", exact: true })
  await expect(back).toHaveAttribute("href", listing)
  await page.locator("summary").filter({ hasText: `Acabamentos de ${name}` }).click()
  await page.getByLabel(`Cor da estrutura de ${name}`, { exact: true }).selectOption("Preto")
  await page.getByLabel(`Tipo de anilheiro de ${name}`, { exact: true }).selectOption("Olímpico")
  await page.getByLabel("Desconto (%)", { exact: true }).fill("10")
  await page.getByRole("button", { name: "Simular", exact: true }).click()
  await expect(page.getByRole("region", { name: "Resultado da simulação", exact: true })).toContainText("R$ 180,00")
  await expect(page.getByText("Selecione o cliente e informe o vencimento para criar o pedido.", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Continuar pedido", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Dados para criar o pedido", exact: true })).toBeFocused()
  await chooseCustomer(page)
  await page.screenshot({ path: info.outputPath(`commercial-ready-${width}.png`), fullPage: true })
  await page.getByRole("button", { name: "Criar pedido com estas condições", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/vendas/pedidos/${record}$`))
  await expect(page.getByRole("heading", { name: /127/ })).toBeVisible()
  await expect(page.getByRole("region", { name: "Resumo financeiro do pedido", exact: true })).toContainText("R$ 180,00")
  expect(sent).toMatchObject({ customerId: customer, dueDate: "2026-12-30", simulation: { line: "national", versionId: version, discount: { kind: "percent", value: 1000 }, items: [{ productId: product, structureColor: "Preto", plateHolderColor: null, plateHolderType: "Olímpico" }] }, digest: "a".repeat(64) })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("atualiza tabela obsoleta sem perder cliente, vencimento ou acabamentos", async ({ page }) => {
  let tableReads = 0
  let refreshFailed = false
  const nextVersion = "77777777-7777-4777-8777-777777777777"
  await page.route("**/api/erp/commercial/tables/imported", route => {
    tableReads++
    if (tableReads > 1 && !refreshFailed) { refreshFailed = true; return route.fulfill({ status: 503, json: { title: "Publicação temporariamente indisponível" } }) }
    return route.fulfill({ json: { tenantId: tenant, line: "imported", canManage: false, data: { ...table, id: tableReads > 1 ? nextVersion : version, version: tableReads > 1 ? 7 : 6 } } })
  })
  const simulations: Record<string, unknown>[] = []
  await page.route("**/api/erp/commercial/simulate", route => {
    const input = route.request().postDataJSON(); simulations.push(input)
    return route.fulfill({ json: { tenantId: tenant, version: tableReads > 1 ? 7 : 6, digest: "a".repeat(64), sale: sale(), director: null } })
  })
  await page.route("**/api/erp/commercial/orders", route => route.fulfill({ status: 412, json: { title: "A tabela mudou. Simule novamente." } }))
  await page.goto(`/vendas/simulador?produto=${product}`)
  await chooseCustomer(page)
  await page.locator("summary").filter({ hasText: `Acabamentos de ${name}` }).click()
  await page.getByLabel(`Cor da estrutura de ${name}`, { exact: true }).selectOption("Preto")
  await page.getByRole("button", { name: "Simular", exact: true }).click()
  await page.getByRole("button", { name: "Criar pedido com estas condições", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "A tabela mudou" })).toBeVisible()
  await page.getByRole("button", { name: "Atualizar tabela e simular novamente", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Publicação temporariamente indisponível" })).toBeVisible()
  await expect(page.getByText("Cliente selecionado: Academia de teste", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Atualizar tabela e simular novamente", exact: true }).click()
  await expect(page.getByText("Cliente selecionado: Academia de teste", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Vencimento da conta a receber", { exact: true })).toHaveValue("2026-12-30")
  await expect(page.getByLabel(`Cor da estrutura de ${name}`, { exact: true })).toHaveValue("Preto")
  await page.getByRole("button", { name: "Simular", exact: true }).click()
  expect(simulations.at(-1)).toMatchObject({ versionId: nextVersion, items: [{ productId: product, structureColor: "Preto" }] })
})

test("retorno à tabela pede confirmação e conserva a busca nacional", async ({ page, baseURL }) => {
  await page.goto(listing)
  await page.getByRole("row").filter({ hasText: name }).getByRole("link", { name: "Simular pedido", exact: true }).click()
  await page.getByLabel(`Quantidade de ${name}`, { exact: true }).fill("2")
  page.once("dialog", dialog => dialog.dismiss())
  await page.getByRole("link", { name: "Tabela de preços", exact: true }).click()
  await expect(page.getByLabel(`Quantidade de ${name}`, { exact: true })).toHaveValue("2")
  page.once("dialog", dialog => dialog.accept())
  await page.getByRole("link", { name: "Tabela de preços", exact: true }).click()
  await expect(page).toHaveURL(new URL(listing, baseURL).toString())
  await expect(page.getByRole("button", { name: "Nacional", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("navigation", { name: "Paginação da tabela" })).toContainText("15 a 16 de 16")
})

test("equipamento removido da publicação continua visível e exige remoção explícita da negociação", async ({ page }) => {
  const removed = "99999999-9999-4999-8999-999999999999"
  const simulations: Record<string, unknown>[] = []
  await page.route(`**/api/erp/products/${removed}`, route => route.fulfill({ json: { tenantId: tenant, data: {
    id: removed, name: "Equipamento retirado da tabela", sku: "ANTIGO-001", structureColors: [], upholsteryColors: [], upholsteryConfigurable: false, hasPhoto: false,
  } } }))
  await page.route("**/api/erp/commercial/simulate", route => {
    simulations.push(route.request().postDataJSON())
    return route.fulfill({ json: { tenantId: tenant, version: 6, digest: "a".repeat(64), sale: sale(), director: null } })
  })
  await page.goto(`/vendas/simulador?itens=${product}:1,${removed}:2`)
  const items = page.getByRole("table", { name: "Equipamentos da simulação", exact: true })
  const quantities = items.locator('input[inputmode="numeric"]')
  await expect(quantities).toHaveCount(2)
  await expect(quantities.nth(0)).toHaveValue("1")
  await expect(quantities.nth(1)).toHaveValue("2")
  await page.getByRole("button", { name: "Simular", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: /^Há equipamentos indisponíveis/ })).toBeVisible()
  expect(simulations).toHaveLength(0)
  // The user must explicitly remove the missing equipment before the remaining item can be quoted.
  await items.getByRole("button", { name: /^Remover equipamento/ }).last().click()
  await expect(quantities).toHaveCount(1)
  await page.getByRole("button", { name: "Simular", exact: true }).click()
  await expect(page.getByRole("region", { name: "Resultado da simulação", exact: true })).toContainText("R$ 180,00")
  expect(simulations).toHaveLength(1)
  expect(simulations[0]).toMatchObject({ items: [{ productId: product, quantity: 1 }] })
})
