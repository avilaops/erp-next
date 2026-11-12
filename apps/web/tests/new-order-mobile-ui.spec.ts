import { expect, test, type Page } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"
import type { SimulationInput } from "../src/features/sales/negotiation-types"
import type { CheckoutInput } from "../src/features/sales/commercial-payment-model"

const product = "33333333-3333-4333-8333-333333333333"
const version = "55555555-5555-4555-8555-555555555555"
const pix = "66666666-6666-4666-8666-666666666666"
const boleto = "77777777-7777-4777-8777-777777777777"
const customerId = "44444444-4444-4444-8444-444444444444"
async function fixture(page: Page, options: { authority?: string; limit?: number; approval?: boolean; failure?: boolean } = {}) {
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant, legalName: "LUDUS EQUIPAMENTOS PARA MUSCULACAO LTDA" }, permissions: ["sales.orders.read", "sales.orders.manage", "catalog.parties.read", "catalog.parties.manage", "catalog.products.read"] } }))
  await page.route(/\/api\/erp\/parties\?/, route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: [], total: 0 } }))
  await page.route(/\/api\/erp\/commercial\/tables\/imported(?:\?.*)?$/, route => route.fulfill({ json: { tenantId: tenant, line: "imported", authority: options.authority || "seller", canManage: false, canCreateOrder: true, paymentMethods: [{ id: pix, name: "PIX", kind: "pix" }, { id: boleto, name: "Boleto", kind: "boleto" }], data: { id: version, version: 6, publishedAt: "2026-11-12T12:00:00Z", originState: "SP", freeDiscountBps: 2000, minimumDownPaymentBps: 7000, destinations: [{ state: "SP", taxpayer: false, maxOwnDiscountBps: options.limit ?? 2000 }], items: [{ productId: product, name: "Mesa flexora", sku: "LD-B001", unit: "UN", ipiBps: 1300, priceWithoutIpiCents: 100000, priceWithIpiCents: 113000, available: true }] } } }))
  await page.route(`**/api/erp/products/${product}`, route => route.fulfill({ json: { tenantId: tenant, data: { id: product, name: "Mesa flexora", sku: "LD-B001", structureColors: [], upholsteryColors: [], upholsteryConfigurable: false, hasPhoto: false, weight: "25.5" } } }))
  await page.route(`**/api/erp/products/${product}/catalog`, route => route.fulfill({ json: { tenantId: tenant, data: { weight: "25.5" } } }))
  await page.route("**/api/erp/commercial/simulate", route => {
    if (options.failure) return route.fulfill({ status: 503, json: { title: "Preço temporariamente indisponível" } })
    const input = route.request().postDataJSON() as SimulationInput
    const qty = input.items[0].quantity
    const unit = input.discount.kind === "total" ? Math.round(input.discount.value / qty / 1.13) : Math.round(100000 * (10000 - input.discount.value) / 10000)
    const net = unit * qty, ipi = Math.ceil(unit * .13) * qty, total = net + ipi
    return route.fulfill({ json: { tenantId: tenant, version: 6, digest: "a".repeat(64), sale: { calculatorVersion: "mobile-fixture", items: [{ productId: product, name: "Mesa flexora", sku: "LD-B001", quantity: qty, tableUnitCents: 100000, netCents: net, ipiCents: ipi, totalCents: total }], tableTotalCents: 100000 * qty, discountCents: 100000 * qty - net, discountBps: Math.round((100000 * qty - net) / (100000 * qty) * 10000), netSaleCents: net, ipiBps: 1300, ipiCents: ipi, totalCents: total, freeDiscountBps: 2000, minimumDownPaymentBps: 7000, minimumDownPaymentCents: Math.ceil(total * .7), downPaymentCents: input.downPaymentCents ?? Math.ceil(total * .7), freightCents: input.freightCents, approvalReasons: options.approval ? ["desconto-acima-do-livre"] : [] }, director: null } })
  })
}
async function addEquipment(page: Page) {
  const search = page.getByLabel("Buscar equipamento", { exact: true })
  await search.fill("Mesa")
  await page.getByRole("button", { name: /^Mesa flexora/ }).click()
  await expect(page.getByRole("region", { name: "Totais do pedido", exact: true })).toContainText("R$ 1.130,00")
}
test.beforeEach(async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  page.on("pageerror", error => console.log("BROWSER_PAGE_ERROR", error.message))
  page.on("console", message => { if (message.type() === "error") console.log("BROWSER_CONSOLE_ERROR", message.text()) })
  page.on("requestfailed", request => console.log("BROWSER_REQUEST_FAILED", new URL(request.url()).pathname, request.failure()?.errorText))
})

for (const theme of ["light", "dark"]) test(`pendências explicam salvar e levam ao primeiro campo sem gravar: ${theme}`, async ({ page }, info) => {
  await page.addInitScript(theme => localStorage.setItem("erp-theme", theme), theme)
  await fixture(page)
  const writes: string[] = []
  page.on("request", request => { if (request.method() !== "GET" && /\/api\/erp\/(parties|commercial\/orders)(?:\?|$)/.test(request.url())) writes.push(request.url()) })
  await page.goto("/vendas/pedidos/novo")
  await expect(page.getByRole("heading", { name: "Novo pedido", exact: true })).toBeVisible({ timeout: 20000 })
  await expect(page.getByRole("navigation", { name: "Seções do pedido" })).toBeVisible()
  await expect(page.getByRole("region", { name: "Resumo rápido do pedido" })).toBeVisible()
  await page.getByRole("button", { name: "Salvar pedido", exact: true }).click()
  await expect(page.getByRole("region", { name: "Pendências do pedido" })).toContainText("Equipamentos")
  await expect(page.getByLabel("Buscar equipamento", { exact: true })).toBeFocused()
  expect(writes).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath("mobile-pending.png"), fullPage: true })
})

test("resumo sai da área do teclado e navegação preserva o preenchimento", async ({ page }) => {
  await fixture(page)
  await page.goto("/vendas/pedidos/novo")
  const quick = page.getByRole("region", { name: "Resumo rápido do pedido" })
  await expect(quick).toBeVisible()
  await page.getByLabel("Buscar equipamento", { exact: true }).focus()
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: 380 })
    window.visualViewport!.dispatchEvent(new Event("resize"))
  })
  await expect(page.locator(".order-quick-summary")).toBeHidden()
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: innerHeight })
    window.visualViewport!.dispatchEvent(new Event("resize"))
  })
  await expect(quick).toBeVisible()
  await addEquipment(page)
  page.once("dialog", dialog => dialog.dismiss())
  await page.getByRole("link", { name: "Suas empresas", exact: true }).click()
  await expect(page).toHaveURL(/\/vendas\/pedidos\/novo$/)
  await expect(page.getByLabel("Quantidade de Mesa flexora", { exact: true })).toHaveValue("1")
})

test("vencimento nativo cabe no cartão e indica confirmação sem data", async ({ page }, info) => {
  await fixture(page)
  await page.goto("/vendas/pedidos/novo")
  await expect(page.getByRole("heading", { name: "Novo pedido", exact: true })).toBeVisible({ timeout: 20000 })
  await addEquipment(page)
  const input = page.locator('[data-checkout-field="entry-date"]')
  await input.scrollIntoViewIfNeeded()
  const geometry = await input.evaluate(element => {
    const input = element.getBoundingClientRect()
    const section = element.closest('.order-section')!.getBoundingClientRect()
    return { left: input.left, right: input.right, sectionLeft: section.left, sectionRight: section.right, document: document.documentElement.scrollWidth, viewport: innerWidth }
  })
  expect(geometry.right).toBeLessThanOrEqual(geometry.sectionRight - 8)
  expect(geometry.left).toBeGreaterThanOrEqual(geometry.sectionLeft)
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport)
  await expect(page.getByText("Na confirmação do pedido", { exact: true })).toBeVisible()
  await input.fill("2026-12-10")
  await expect(input).toHaveValue("2026-12-10")
  await page.screenshot({ path: info.outputPath("mobile-entry-date.png") })
})

test("atalhos preservam desconto, frete e total sem confundir teto com aprovação", async ({ page }, info) => {
  await fixture(page, { authority: "director", limit: 9999, approval: true })
  await page.goto("/vendas/pedidos/novo")
  await addEquipment(page)
  await page.getByRole("navigation", { name: "Seções do pedido" }).getByRole("button", { name: /Desconto/ }).click()
  await page.getByLabel("Desconto (%)", { exact: true }).fill("10")
  const quick = page.getByRole("region", { name: "Resumo rápido do pedido", exact: true })
  await expect(quick).toContainText("R$ 1.017,00")
  await page.getByRole("region", { name: "Desconto", exact: true }).getByText("Perfil e limite de referência", { exact: true }).click()
  await expect(page.getByRole("region", { name: "Desconto", exact: true })).toContainText("Diretoria · limite de referência da tabela: 99,99%")
  await expect(page.getByRole("meter", { name: "Desconto atual" })).toHaveAttribute("value", "1000")
  await expect(page.getByText("Aprovação necessária", { exact: true })).toBeVisible()
  await page.getByLabel("Modalidade de entrega", { exact: true }).selectOption("company")
  await page.getByLabel("Frete por nossa conta (R$)", { exact: true }).fill("100,00")
  await expect(quick).toContainText("R$ 1.017,00")
  await page.getByLabel("Valor negociado (com IPI)", { exact: true }).fill("1017,00")
  await expect(page.getByLabel("Desconto (%)", { exact: true })).toHaveValue(/^10(?:[,.]00)?$/)
  await page.getByRole("button", { name: "Revisar pedido", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Revisão do pedido", exact: true })).toBeFocused()
  await expect(page.getByRole("region", { name: "Totais do pedido", exact: true })).toContainText("Custo da empresa, sem acréscimo")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath("mobile-negotiation-review.png"), fullPage: true })
})

for (const person of ["cpf", "cnpj"] as const) test(`cliente novo ${person}, outra UF e pagamento integral salvam com número`, async ({ page }, info) => {
  await fixture(page)
  const partyWrites: object[] = [], orders: { checkout: CheckoutInput; simulation: SimulationInput }[] = []
  await page.route("**/api/erp/parties", route => { const body = route.request().postDataJSON(); partyWrites.push(body); return route.fulfill({ status: 201, headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: { ...body, id: customerId, revision: 1 } } }) })
  await page.route("**/api/erp/commercial/orders", route => { orders.push(route.request().postDataJSON()); return route.fulfill({ status: 201, headers: { ETag: '"1"' }, json: { tenantId: tenant, id: record } }) })
  await page.route(`**/api/erp/orders/${record}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, pricingOrigin: true, data: { id: record, revision: 1, number: "129", status: "draft", customerId, customerName: "Cliente mobile", customerTaxId: person === "cpf" ? "52998224725" : "11222333000181", dueDate: "2026-12-12", amount: "1130.00" }, checkout: { ...orders[0].checkout, confirmationCreatesReceivables: true, entry: { ...orders[0].checkout.entry, amountCents: 113000, paymentMethod: { id: pix, name: "PIX", modality: "pix" } }, installments: [], customer: { legalName: "Cliente mobile", taxId: person === "cpf" ? "52998224725" : "11222333000181", addresses: [], contacts: [] } }, items: [] } }))
  await page.goto("/vendas/pedidos/novo")
  await addEquipment(page)
  await page.getByRole("button", { name: "Cadastrar cliente", exact: true }).click()
  if (person === "cpf") await page.getByRole("button", { name: "Pessoa física (CPF)", exact: true }).click()
  await page.getByLabel(person === "cpf" ? "CPF" : "CNPJ", { exact: true }).fill(person === "cpf" ? "52998224725" : "11222333000181")
  await page.getByLabel(person === "cpf" ? "Nome completo" : "Razão social", { exact: true }).fill("Cliente mobile")
  if (person === "cnpj") await page.getByLabel("Inscrição estadual", { exact: true }).fill("ISENTO")
  await page.getByLabel("Nome do responsável", { exact: true }).fill("Maria")
  await page.getByLabel("Celular", { exact: true }).fill("11987654321")
  await page.getByLabel("E-mail", { exact: true }).fill("maria@example.test")
  await page.getByLabel("CEP", { exact: true }).fill("01001000")
  await page.getByLabel("Endereço", { exact: true }).fill("Rua Teste")
  await page.getByLabel("Número", { exact: true }).fill("123")
  await page.getByLabel("Bairro", { exact: true }).fill("Centro")
  await page.getByLabel("Cidade", { exact: true }).fill("São Paulo")
  await page.getByLabel("UF", { exact: true }).selectOption("SP")
  await page.getByLabel("Estado de entrega", { exact: true }).selectOption("RJ")
  await expect(page.getByText("Outra UF informada para entrega: RJ.", { exact: true })).toBeVisible()
  await page.getByLabel("Modalidade de entrega", { exact: true }).selectOption("pickup")
  await page.getByLabel("Prazo de fabricação", { exact: true }).fill("45")
  await page.getByLabel("Entrada (R$)", { exact: true }).fill("1130,00")
  await expect(page.getByRole("region", { name: "Totais do pedido", exact: true })).toContainText("Entrada (100%)")
  await page.getByLabel("Forma da entrada", { exact: true }).selectOption(pix)
  await expect(page.getByLabel("Intervalo (dias)", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Salvar pedido", exact: true }).click()
  await expect(page).toHaveURL(new RegExp("/vendas/pedidos/" + record), { timeout: 30000 })
  expect(partyWrites).toHaveLength(1); expect(orders).toHaveLength(1)
  expect(orders[0].simulation.destinationState).toBe("RJ")
  expect(orders[0].checkout.installments).toEqual([])
  expect(orders[0].checkout.deliveryNotes).toContain("retirada pelo cliente")
  await expect(page.getByRole("heading", { name: "PV-000129", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Confirmar, reservar e gerar parcelas", exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath(`mobile-saved-${person}.png`) })
})

test("erro de cálculo preserva equipamento, explica bloqueio e não fabrica total", async ({ page }) => {
  await fixture(page, { failure: true })
  await page.goto("/vendas/pedidos/novo")
  await page.getByLabel("Buscar equipamento", { exact: true }).fill("Mesa")
  await page.getByRole("button", { name: /^Mesa flexora/ }).click()
  await expect(page.getByRole("region", { name: "Resumo rápido do pedido" })).toContainText("Confira o cálculo")
  await expect(page.getByRole("region", { name: "Salvar pedido", exact: true })).toContainText("Preço temporariamente indisponível")
  await expect(page.getByLabel("Quantidade de Mesa flexora", { exact: true })).toHaveValue("1")
  await expect(page.getByRole("button", { name: "Calcular novamente", exact: true })).toBeEnabled()
})

for (const value of ["abc", "2000,00"]) test(`entrada inválida ${value} mantém pendência e foco no campo correto`, async ({ page }) => {
  await fixture(page)
  await page.goto("/vendas/pedidos/novo")
  await addEquipment(page)
  await page.getByLabel("Entrada (R$)", { exact: true }).fill(value)
  const pending = page.getByRole("region", { name: "Pendências do pedido", exact: true })
  await expect(pending.getByRole("button", { name: /entrada/i })).toBeVisible()
  await pending.getByRole("button", { name: /entrada/i }).first().click()
  await expect(page.getByLabel("Entrada (R$)", { exact: true })).toBeFocused()
  await expect(page.getByLabel("Entrada (R$)", { exact: true })).toHaveAttribute("aria-invalid", "true")
})

for (const target of ["percent", "total", "freight"] as const) test(`valor inválido em ${target} tem mensagem local e revisão aponta o campo`, async ({ page }) => {
  await fixture(page)
  await page.goto("/vendas/pedidos/novo")
  await addEquipment(page)
  if (target === "freight") await page.getByLabel("Modalidade de entrega", { exact: true }).selectOption("company")
  const field = page.getByLabel(target === "percent" ? "Desconto (%)" : target === "total" ? "Valor negociado (com IPI)" : "Frete por nossa conta (R$)", { exact: true })
  await field.fill("abc")
  const pending = page.getByRole("region", { name: "Pendências do pedido", exact: true })
  const link = pending.getByRole("button", { name: target === "percent" ? /desconto/i : target === "total" ? /valor negociado/i : /frete/i }).first()
  await expect(link).toBeVisible()
  await link.click()
  await expect(field).toBeFocused()
  await expect(field).toHaveAttribute("aria-invalid", "true")
  const description = await field.getAttribute("aria-describedby")
  expect(description).toBeTruthy()
  await expect(page.locator('[id="' + description + '"]')).toBeVisible()
})

test("acesso sem gestão de clientes leva à busca de cadastro existente", async ({ page }) => {
  await fixture(page)
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["sales.orders.read", "sales.orders.manage", "catalog.parties.read", "catalog.products.read"] } }))
  await page.goto("/vendas/pedidos/novo")
  await addEquipment(page)
  await page.getByRole("button", { name: "Salvar pedido", exact: true }).click()
  await expect(page.getByLabel("Buscar cliente", { exact: true })).toBeFocused()
  await expect(page.getByLabel("CNPJ", { exact: true })).toHaveCount(0)
})
