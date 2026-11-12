import { expect, test, type Page } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"
import type { CheckoutInput } from "../src/features/sales/commercial-payment-model"
import type { SimulationInput } from "../src/features/sales/negotiation-types"

const product = "33333333-3333-4333-8333-333333333333"
const version = "55555555-5555-4555-8555-555555555555"
const pix = "66666666-6666-4666-8666-666666666666"
const boleto = "77777777-7777-4777-8777-777777777777"
const equipment = { productId: product, name: "Mesa flexora", sku: "LD-B001", unit: "UN", ipiBps: 1300, priceWithoutIpiCents: 100000, priceWithIpiCents: 113000, available: true }

async function fixture(page: Page) {
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["sales.orders.read", "sales.orders.manage", "catalog.parties.read", "catalog.parties.manage", "catalog.products.read"] } }))
  await page.route(/\/api\/erp\/orders\?/, route => route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: [], total: 0 } }))
  await page.route(/\/api\/erp\/parties\?/, route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: [], total: 0 } }))
  await page.route(/\/api\/erp\/commercial\/tables\/imported(?:\?.*)?$/, route => route.fulfill({ json: {
    tenantId: tenant, line: "imported", authority: "seller", canManage: false, canCreateOrder: true,
    paymentMethods: [{ id: pix, name: "PIX", kind: "pix" }, { id: boleto, name: "Boleto", kind: "boleto" }],
    data: { id: version, version: 41, publishedAt: "2026-11-12T12:00:00Z", originState: "SP", freeDiscountBps: 2000, minimumDownPaymentBps: 7000, items: [equipment] },
  } }))
  await page.route(`**/api/erp/products/${product}`, route => route.fulfill({ json: { tenantId: tenant, data: { id: product, name: equipment.name, sku: equipment.sku, structureColors: [], upholsteryColors: [], upholsteryConfigurable: false, hasPhoto: false, weight: "25.5" } } }))
  await page.route(`**/api/erp/products/${product}/catalog`, route => route.fulfill({ json: { tenantId: tenant, data: { weight: "25.5" } } }))
}

test.beforeEach(async ({ context }) => { await installFrontendFixture(context) })

for (const { width, theme } of [{ width: 390, theme: "light" }, { width: 640, theme: "light" }, { width: 649, theme: "dark" }, { width: 1440, theme: "light" }, { width: 1525, theme: "dark" }, { width: 1854, theme: "dark" }]) test(`novo pedido vazio segue a referência em ${width}px ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 })
  await page.addInitScript(theme => localStorage.setItem("erp-theme", theme), theme)
  await fixture(page)
  const writes: string[] = []
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()) })
  page.on("request", request => { if (request.method() !== "GET" && /\/api\/erp\/(parties|orders|commercial\/orders)(?:\?|$)/.test(request.url())) writes.push(request.url()) })
  await page.goto("/vendas/pedidos/novo")
  await expect(page.getByRole("heading", { name: "Novo pedido", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Equipamentos", exact: true })).toBeVisible()
  await expect(page.getByText("Nenhum equipamento ainda.", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Cliente", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Cadastrar cliente", exact: true })).toBeVisible()
  await expect(page.getByLabel("Razão social", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("heading", { name: "Forma de pagamento", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Desconto", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Salvar pedido", exact: true })).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const client = await page.getByRole("region", { name: "Cliente", exact: true }).boundingBox()
  const discount = await page.getByRole("region", { name: "Desconto", exact: true }).boundingBox()
  expect(client).not.toBeNull(); expect(discount).not.toBeNull()
  if (width >= 1200) expect(discount!.x).toBeGreaterThan(client!.x + client!.width - 1)
  else expect(discount!.y).toBeGreaterThan(client!.y)
  expect(writes).toEqual([])
  expect(errors).toEqual([])
  await page.screenshot({ path: info.outputPath(`new-order-empty-${width}-${theme}.png`), fullPage: true })
})

for (const uncertainty of ["unavailable", "foreignTenant", "authRetry", "customerUnavailable", "existing"] as const) test(`negocia e preserva cliente, parcelas e confirmação: ${uncertainty}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.addInitScript(() => localStorage.setItem("erp-theme", "dark"))
  await fixture(page)
  const customerId = "44444444-4444-4444-8444-444444444444"
  const existing = uncertainty === "existing"
  const partyWrites: { body: Record<string, unknown>; key: string }[] = []
  const orderWrites: { body: { customerId: string; digest: string; simulation: SimulationInput; dueDate: string; checkout: CheckoutInput }; key: string }[] = []
  const saleFor = (input: SimulationInput) => {
    const qty = input.items[0].quantity
    const unit = Math.round(100000 * (10000 - input.discount.value) / 10000)
    const net = unit * qty, ipi = Math.ceil(unit * 1300 / 10000) * qty, total = net + ipi
    return { calculatorVersion: "new-order-browser-fixture", items: [{ productId: product, name: equipment.name, sku: equipment.sku, quantity: qty, tableUnitCents: 100000, netCents: net, ipiCents: ipi, totalCents: total }], tableTotalCents: 100000 * qty, discountCents: 100000 * qty - net, discountBps: input.discount.value, netSaleCents: net, ipiBps: 1300, ipiCents: ipi, totalCents: total, freeDiscountBps: 2000, minimumDownPaymentBps: 7000, minimumDownPaymentCents: Math.ceil(total * .7), downPaymentCents: input.downPaymentCents ?? Math.ceil(total * .7), freightCents: input.freightCents, approvalReasons: [] }
  }
  await page.route("**/api/erp/commercial/simulate", route => {
    const input = route.request().postDataJSON() as SimulationInput
    return route.fulfill({ json: { tenantId: tenant, version: 41, digest: "a".repeat(64), sale: saleFor(input), director: null } })
  })
  await page.route("**/api/erp/registry-lookups", route => {
    const input = route.request().postDataJSON()
    return route.fulfill({ json: { tenantId: tenant, kind: input.kind, context: "party", value: input.value, status: "found", source: "Fixture cadastral", expiresAt: new Date(Date.now() + 60_000).toISOString(), data: { fields: input.kind === "cep" ? { postalCode: "01001000", street: "Rua dos Testes", district: "Centro", city: "São Paulo", state: "SP", municipalityCode: "3550308" } : {} }, warnings: [] } })
  })
  await page.route("**/api/erp/parties", route => {
    const body = route.request().postDataJSON()
    partyWrites.push({ body, key: route.request().headers()["idempotency-key"] })
    if (uncertainty === "customerUnavailable" && partyWrites.length === 1) return route.fulfill({ status: 503, json: { title: "Cadastro com confirmação pendente na fixture" } })
    return route.fulfill({ status: 201, headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: { ...body, id: customerId, revision: 1 } } })
  })
  await page.route("**/api/erp/commercial/orders", route => {
    orderWrites.push({ body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] })
    if (orderWrites.length === 1 && ["unavailable", "authRetry"].includes(uncertainty)) return route.fulfill({ status: 503, json: { title: "Confirmação pendente na fixture" } })
    if (orderWrites.length === 1 && uncertainty === "foreignTenant") return route.fulfill({ status: 201, headers: { ETag: '"1"' }, json: { tenantId: "99999999-9999-4999-8999-999999999999", id: record } })
    if (orderWrites.length === 2 && uncertainty === "authRetry") return route.fulfill({ status: 401, json: { title: "Sessão precisa ser conferida na fixture" } })
    return route.fulfill({ status: 201, headers: { ETag: '"1"' }, json: { tenantId: tenant, id: record } })
  })
  await page.route(`**/api/erp/orders/${record}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: false, pricingOrigin: true, data: { id: record, number: "128", status: "draft", customerId, customerName: "Cliente de teste", customerTaxId: "11222333000181", dueDate: "2026-12-12", amount: "2034.00" }, items: [] } }))
  if (existing) {
    const party = { id: customerId, revision: 1, personType: "juridica", legalName: "Cliente de teste", tradeName: null, taxId: "11222333000181", email: "marina@example.test", phone: "11987654321", isCustomer: true, isSupplier: true, status: "active", addresses: [{ label: "", primary: true, postalCode: "01001000", street: "Rua dos Testes", number: "123", district: "Centro", city: "São Paulo", state: "SP", complement: null, municipalityCode: "3550308" }], contacts: [{ name: "Marina", role: "Proprietária", primary: true, email: "marina@example.test", phone: "11987654321" }] }
    await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["sales.orders.read", "sales.orders.manage", "catalog.parties.read", "catalog.products.read"] } }))
    await page.route(/\/api\/erp\/parties\?/, route => route.fulfill({ json: { tenantId: tenant, canEdit: false, data: [party], total: 1 } }))
    await page.route(`**/api/erp/parties/${customerId}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: false, data: party } }))
  }
  await page.goto("/vendas/pedidos/novo")
  await page.getByLabel("Buscar equipamento", { exact: true }).fill("Mesa")
  await page.getByRole("button", { name: /^Mesa flexora/ }).click()
  await expect(page.getByLabel("Quantidade de Mesa flexora", { exact: true })).toHaveValue("1")
  await page.getByLabel("Buscar equipamento", { exact: true }).fill("LD-B001")
  await page.getByRole("button", { name: /^Mesa flexora/ }).click()
  await expect(page.getByLabel("Quantidade de Mesa flexora", { exact: true })).toHaveValue("2")
  await expect(page.getByRole("region", { name: "Peso do pedido", exact: true })).toContainText("51 kg")
  await expect(page.getByRole("region", { name: "Totais do pedido", exact: true })).toContainText("R$ 2.260,00")
  if (existing) {
    await page.getByRole("button", { name: "Pesquisar cliente", exact: true }).click()
    await page.getByRole("button", { name: "Selecionar Cliente de teste", exact: true }).click()
    await expect(page.locator(".order-customer-selected")).toContainText("Cliente de teste")
    await expect(page.getByRole("button", { name: "Editar cadastro", exact: true })).toHaveCount(0)
  } else {
  await page.getByRole("button", { name: "Cadastrar cliente", exact: true }).click()
  await page.getByLabel("CNPJ", { exact: true }).fill("11222333000181")
  await page.getByLabel("Razão social", { exact: true }).fill("Cliente de teste")
  await page.getByLabel("Nome do responsável", { exact: true }).fill("Marina")
  await page.getByLabel("Celular", { exact: true }).fill("11987654321")
  await page.getByLabel("E-mail", { exact: true }).fill("marina@example.test")
  await page.getByLabel("CEP", { exact: true }).fill("01001000")
  await expect(page.getByLabel("Endereço", { exact: true })).toHaveValue("Rua dos Testes")
  await expect(page.getByText("Código IBGE: 3550308", { exact: true })).toBeVisible()
  await page.getByLabel("Número", { exact: true }).fill("123")
  }
  await page.getByLabel("Inscrição estadual", { exact: true }).fill("ISENTO")
  await page.getByLabel("Prazo de fabricação", { exact: true }).fill("45")
  await page.getByLabel("Forma da entrada", { exact: true }).selectOption(pix)
  await page.getByLabel("Forma do saldo", { exact: true }).selectOption(boleto)
  await page.getByLabel("Parcelas", { exact: true }).fill("2")
  await page.getByRole("button", { name: "Gerar parcelas", exact: true }).click()
  await page.getByLabel("Desconto (%)", { exact: true }).fill("10")
  await expect(page.getByRole("region", { name: "Totais do pedido", exact: true })).toContainText("R$ 2.034,00")
  await page.getByRole("button", { name: "Salvar pedido", exact: true }).click()
  await expect(page.getByText("Gere ou ajuste as parcelas: a soma deve corresponder ao saldo da negociação.", { exact: true }).first()).toBeVisible()
  expect(partyWrites).toHaveLength(0)
  expect(orderWrites).toHaveLength(0)
  await page.getByRole("button", { name: "Gerar parcelas", exact: true }).click()
  await page.getByLabel("Observações do pagamento", { exact: true }).fill("Entrada por PIX, saldo combinado.")
  await page.screenshot({ path: info.outputPath("new-order-filled-desktop-dark.png"), fullPage: true })
  if (uncertainty === "unavailable") {
    for (const width of [390, 640]) {
      await page.setViewportSize({ width, height: 1000 })
      try {
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      } catch (error) {
        const geometry = await page.evaluate(() => {
          const describe = (element: Element) => {
            const box = element.getBoundingClientRect(), style = getComputedStyle(element)
            return { tag: element.tagName, className: element.className, right: box.right, width: box.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, overflow: style.overflowX, columns: style.gridTemplateColumns }
          }
          return { viewport: innerWidth, width: document.documentElement.scrollWidth, regions: [...document.querySelectorAll(".commercial-order-page, .commercial-order-layout, .order-equipment-scroll, .order-section, .order-customer-area, .order-payment-fields, .order-payment-grid")].map(describe), outside: [...document.querySelectorAll("body *")].filter(element => element.getBoundingClientRect().right > innerWidth + 1).map(describe).slice(0, 35) }
        })
        await info.attach(`overflow-${width}`, { body: JSON.stringify(geometry, null, 2), contentType: "application/json" })
        await page.screenshot({ path: info.outputPath(`overflow-${width}.png`), fullPage: true })
        throw error
      }
      await expect(page.getByLabel("Razão social", { exact: true })).toHaveValue("Cliente de teste")
      await page.screenshot({ path: info.outputPath(`new-order-filled-${width}-dark.png`), fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  await page.getByRole("button", { name: "Salvar pedido", exact: true }).click()
  if (!existing) {
    const confirmation = uncertainty === "customerUnavailable" ? "Conferir cadastro e salvar pedido" : "Conferir criação do pedido"
    await expect(page.getByRole("button", { name: confirmation, exact: true })).toBeEnabled()
    expect(partyWrites).toHaveLength(1)
    if (uncertainty === "customerUnavailable") expect(orderWrites).toHaveLength(0)
    await page.getByRole("button", { name: confirmation, exact: true }).click()
    if (uncertainty === "authRetry") {
      await expect(page.getByRole("button", { name: confirmation, exact: true })).toBeEnabled()
      expect(orderWrites).toHaveLength(2)
      await page.getByRole("button", { name: confirmation, exact: true }).click()
    }
  }
  await expect(page).toHaveURL(`/vendas/pedidos/${record}`, { timeout: 30_000 })
  expect(partyWrites).toHaveLength(existing ? 0 : uncertainty === "customerUnavailable" ? 2 : 1)
  if (uncertainty === "customerUnavailable") expect(partyWrites[1]).toEqual(partyWrites[0])
  expect(orderWrites).toHaveLength(existing || uncertainty === "customerUnavailable" ? 1 : uncertainty === "authRetry" ? 3 : 2)
  for (const repeated of orderWrites.slice(1)) expect(repeated).toEqual(orderWrites[0])
  expect(orderWrites[0].body.customerId).toBe(customerId)
  expect(orderWrites[0].body.checkout.stateRegistration).toBe("ISENTO")
  expect(orderWrites[0].body.checkout.manufacturingDays).toBe(45)
  expect(orderWrites[0].body.checkout.deliveryNotes).toContain("45 dias úteis")
  expect(orderWrites[0].body.checkout.installments.reduce((sum, row) => sum + row.amountCents, 0)).toBe(61020)
  if (!existing) {
    expect(partyWrites[0].body).not.toHaveProperty("stateRegistration")
    expect((partyWrites[0].body.addresses as { municipalityCode: string }[])[0].municipalityCode).toBe("3550308")
  }
})

test("normalizar quantidade e desconto preserva um cálculo equivalente", async ({ page }) => {
  await fixture(page)
  await page.route("**/api/erp/commercial/simulate", route => {
    const input = route.request().postDataJSON() as SimulationInput
    const total = input.items[0].quantity * 113000
    return route.fulfill({ json: { tenantId: tenant, version: 41, digest: "a".repeat(64), director: null, sale: { calculatorVersion: "normalization-fixture", items: [], tableTotalCents: total, discountCents: 0, discountBps: 0, netSaleCents: total, ipiBps: 0, ipiCents: 0, totalCents: total, freeDiscountBps: 2000, minimumDownPaymentBps: 7000, minimumDownPaymentCents: Math.ceil(total * .7), downPaymentCents: Math.ceil(total * .7), freightCents: 0, approvalReasons: [] } } })
  })
  await page.goto("/vendas/pedidos/novo")
  await page.getByLabel("Buscar equipamento", { exact: true }).fill("Mesa")
  await page.getByRole("button", { name: /^Mesa flexora/ }).click()
  await page.getByLabel("Quantidade de Mesa flexora", { exact: true }).fill("2")
  const totals = page.getByRole("region", { name: "Totais do pedido", exact: true })
  await expect(totals).toContainText("R$ 2.260,00")
  await page.getByLabel("Quantidade de Mesa flexora", { exact: true }).fill("02")
  await expect(totals).toContainText("R$ 2.260,00")
  await page.getByLabel("Desconto (%)", { exact: true }).fill("0,00")
  await expect(totals).toContainText("R$ 2.260,00")
  await expect(page.getByRole("button", { name: "Salvar pedido", exact: true })).toBeEnabled()
})
