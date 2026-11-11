import { expect, test, type Page } from "@playwright/test"
import { installFrontendFixture, record, tenant } from "./helpers/frontend-fixture"
import type { CheckoutInput, CheckoutSnapshot } from "../src/features/sales/commercial-payment-model"
import type { SimulationInput } from "../src/features/sales/negotiation-types"

const product = "33333333-3333-4333-8333-333333333333"
const customer = "44444444-4444-4444-8444-444444444444"
const version = "55555555-5555-4555-8555-555555555555"
const pix = "66666666-6666-4666-8666-666666666666"
const boleto = "77777777-7777-4777-8777-777777777777"
const name = "Remada articulada"
const methods = [{ id: pix, name: "PIX", kind: "pix" }, { id: boleto, name: "Boleto", kind: "boleto" }]
const equipment = { productId: product, name, sku: "LD-A004", unit: "UN", ipiBps: 1300, priceWithoutIpiCents: 1920461, priceWithIpiCents: 2170121 }
const originalCustomer = {
  id: customer, revision: 1, personType: "juridica", legalName: "Academia Horizonte LTDA", tradeName: "Academia Horizonte", taxId: "11222333000181",
  email: "cadastro@example.test", phone: "11999990000",
  addresses: [{ street: "Rua da Fundação", number: "71", complement: "Galpão 2", district: "Centro", city: "São Paulo", state: "SP", postalCode: "01001000", primary: true }],
  contacts: [{ name: "Marina da Academia", email: "marina@example.test", phone: "11987654321", primary: true }],
}

function sale(entry = 1519085) {
  return {
    calculatorVersion: "checkout-browser-fixture", items: [{ ...equipment, quantity: 1, tableUnitCents: 1920461, netCents: 1920461, ipiCents: 249660, totalCents: 2170121 }],
    tableTotalCents: 1920461, discountCents: 0, discountBps: 0, netSaleCents: 1920461, ipiBps: 1300, ipiCents: 249660, totalCents: 2170121,
    freeDiscountBps: 2000, minimumDownPaymentBps: 7000, minimumDownPaymentCents: 1519085, downPaymentCents: entry, freightCents: 0, approvalReasons: [],
  }
}

type Creation = { customerId: string; dueDate: string; digest: string; simulation: SimulationInput; checkout: CheckoutInput }

async function fixture(page: Page) {
  const writes: { pathname: string; body: unknown }[] = []
  const simulations: SimulationInput[] = []
  let creation: Creation | null = null
  let preserved: CheckoutSnapshot | null = null
  let changedPartyReads = 0
  page.on("request", request => {
    if (request.method() !== "GET" && request.url().includes("/api/erp/")) writes.push({ pathname: new URL(request.url()).pathname, body: request.postDataJSON() })
  })
  await page.route("**/api/erp/me", route => route.fulfill({ json: {
    tenant: { id: tenant }, permissions: ["sales.orders.read", "sales.orders.manage", "catalog.parties.read", "catalog.products.read", "inventory.stock.manage", "finance.receivables.manage"],
  } }))
  await page.route(/\/api\/erp\/commercial\/tables\/imported(?:\?.*)?$/, route => route.fulfill({ json: {
    tenantId: tenant, line: "imported", canManage: false, canCreateOrder: true, paymentMethods: methods,
    data: { id: version, version: 41, publishedAt: "2026-11-11T12:00:00Z", originState: "SP", freeDiscountBps: 2000, minimumDownPaymentBps: 7000, items: [equipment] },
  } }))
  await page.route(`**/api/erp/products/${product}`, route => route.fulfill({ json: { tenantId: tenant, data: {
    id: product, name, sku: equipment.sku, structureColors: [], upholsteryColors: [], upholsteryConfigurable: false, hasPhoto: false,
  } } }))
  await page.route(/\/api\/erp\/parties\?/, route => route.fulfill({ json: { tenantId: tenant, total: 1, data: [originalCustomer] } }))
  await page.route(`**/api/erp/parties/${customer}`, route => {
    if (creation) changedPartyReads++
    return route.fulfill({ json: { tenantId: tenant, data: creation ? {
      ...originalCustomer, revision: 2, tradeName: "Cadastro alterado depois", addresses: [{ ...originalCustomer.addresses[0], street: "Rua Nova do Cadastro" }], contacts: [],
    } : originalCustomer } })
  })
  await page.route("**/api/erp/commercial/simulate", route => {
    const input = route.request().postDataJSON() as SimulationInput
    simulations.push(input)
    return route.fulfill({ json: { tenantId: tenant, version: 41, digest: "a".repeat(64), sale: sale(input.downPaymentCents ?? undefined), director: null } })
  })
  await page.route("**/api/erp/commercial/orders", route => {
    creation = route.request().postDataJSON() as Creation
    expect(route.request().headers()["idempotency-key"]).toMatch(/^[a-f0-9-]{36}$/)
    const methodSnapshot = (id: string) => ({ ...methods.find(method => method.id === id)!, modality: id === pix ? "pix" : "boleto" })
    preserved = {
      ...creation.checkout, confirmationCreatesReceivables: true, customer: structuredClone(originalCustomer),
      entry: { ...creation.checkout.entry, amountCents: creation.simulation.downPaymentCents!, paymentMethod: methodSnapshot(creation.checkout.entry.paymentMethodId!) },
      installments: creation.checkout.installments.map((item, index) => ({ ...item, id: `88888888-8888-4888-8888-${String(index + 1).padStart(12, "0")}`, number: index + 1, paymentMethod: methodSnapshot(item.paymentMethodId) })),
    }
    return route.fulfill({ status: 201, headers: { ETag: '"1"' }, json: { tenantId: tenant, id: record } })
  })
  await page.route(`**/api/erp/orders/${record}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: {
    tenantId: tenant, canEdit: true, pricingOrigin: true, checkout: preserved,
    data: { id: record, number: "128", status: "draft", revision: 1, customerId: customer, customerName: originalCustomer.legalName, customerTaxId: originalCustomer.taxId, dueDate: creation?.dueDate || "2026-12-30", amount: "21701.21" },
    items: [{ productId: product, name, sku: equipment.sku, unit: "UN", quantity: "1.000000", unitPrice: "21701.21", amount: "21701.21", structureColor: null, upholsteryColor: null, plateHolderType: null }],
  } }))
  await page.route(`**/api/erp/commercial/orders/${record}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: {
    tenantId: tenant, revision: 1, canApprove: false, approvalStatus: "not_required", decisions: [], director: null, checkout: preserved,
    data: { sale: sale(creation?.simulation.downPaymentCents ?? undefined), version: 41, input: creation?.simulation },
  } }))
  await page.route(`**/api/erp/orders/${record}/pricing`, route => route.fulfill({ json: { tenantId: tenant, data: null, canApprove: false } }))
  return { writes, simulations, creation: () => creation, changedPartyReads: () => changedPartyReads }
}

async function simulate(page: Page) {
  await page.getByRole("button", { name: "Simular", exact: true }).click()
  await expect(page.getByRole("region", { name: "Resultado da simulação", exact: true })).toContainText("R$ 21.701,21")
}

for (const width of [390, 1366]) test(`negociação preserva cliente, entrada e parcelas conferidas em ${width}px`, async ({ context, page, baseURL }, info) => {
  await installFrontendFixture(context, baseURL)
  const state = await fixture(page)
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 })
  await page.goto(`/vendas/simulador?produto=${product}`)
  await simulate(page)
  await page.getByRole("button", { name: "Continuar pedido", exact: true }).click()
  await page.getByLabel("Buscar cliente", { exact: true }).fill("Horizonte")
  await page.getByRole("button", { name: "Pesquisar cliente", exact: true }).click()
  await page.getByRole("button", { name: `Selecionar ${originalCustomer.legalName}`, exact: true }).click()
  await expect(page.getByText("Marina da Academia", { exact: true })).toBeVisible()
  await expect(page.getByText("marina@example.test", { exact: true })).toBeVisible()
  await expect(page.getByText(/Rua da Fundação · 71 · Galpão 2/)).toBeVisible()
  await page.getByLabel("Inscrição estadual do cliente", { exact: true }).fill("110042490114")
  await page.getByLabel("Prazo de fabricação (dias)", { exact: true }).fill("45")
  await page.getByLabel("Observações da entrega", { exact: true }).fill("Entregar no galpão 2 com agendamento.")
  await page.getByLabel("Observações do pagamento", { exact: true }).fill("Entrada por PIX e saldo conforme os vencimentos.")
  await page.getByLabel("Observações do pedido", { exact: true }).fill("Conferir acesso para descarga.")

  // A percentage with a fractional cent must produce the agreed amount exactly.
  await page.getByLabel("Entrada (%)", { exact: true }).fill("75")
  await page.getByLabel("Entrada (%)", { exact: true }).press("Tab")
  await expect(page.getByLabel("Entrada (R$)", { exact: true })).toHaveValue("16275,91")
  await simulate(page)
  expect(state.simulations.at(-1)?.downPaymentCents).toBe(1627591)
  // A direct amount is preserved rather than reconstructed from its rounded percentage.
  await page.getByLabel("Entrada (R$)", { exact: true }).fill("15190,86")
  await simulate(page)
  await expect(page.getByLabel("Entrada (R$)", { exact: true })).toHaveValue("15190,86")
  expect(state.simulations.at(-1)?.downPaymentCents).toBe(1519086)
  await expect(page.getByLabel("Entrada (%)", { exact: true })).toHaveValue("70,00")
  await page.getByLabel("Entrada (%)", { exact: true }).focus()
  await page.getByLabel("Entrada (%)", { exact: true }).press("Tab")
  await expect(page.getByLabel("Entrada (R$)", { exact: true })).toHaveValue("15190,86")
  await expect(page.getByRole("button", { name: "Continuar pedido", exact: true })).toBeVisible()
  await page.getByLabel("Forma da entrada", { exact: true }).selectOption(pix)
  await page.getByLabel("Data da entrada", { exact: true }).fill("2026-11-30")
  await page.getByLabel("Forma do saldo", { exact: true }).selectOption(boleto)
  await page.getByLabel("Parcelas", { exact: true }).fill("3")
  await page.getByLabel("Primeira em (dias)", { exact: true }).fill("30")
  await page.getByLabel("Intervalo (dias)", { exact: true }).fill("30")
  await page.getByLabel("Vencimento da conta a receber", { exact: true }).fill("2026-12-30")
  await page.getByRole("button", { name: "Gerar parcelas", exact: true }).click()
  await expect(page.getByLabel("Valor da parcela 1 (R$)", { exact: true })).toHaveValue("2170,12")
  await expect(page.getByLabel("Valor da parcela 2 (R$)", { exact: true })).toHaveValue("2170,12")
  await expect(page.getByLabel("Valor da parcela 3 (R$)", { exact: true })).toHaveValue("2170,11")
  await expect(page.getByLabel("Vencimento da parcela 1", { exact: true })).toHaveValue("2026-12-30")
  await expect(page.getByLabel("Vencimento da parcela 2", { exact: true })).toHaveValue("2027-01-29")
  await expect(page.getByLabel("Vencimento da parcela 3", { exact: true })).toHaveValue("2027-02-28")
  await page.getByLabel("Vencimento da conta a receber", { exact: true }).fill("2027-01-05")
  await expect(page.getByLabel("Vencimento da parcela 1", { exact: true })).toHaveValue("2027-01-05")
  await page.getByLabel("Vencimento da conta a receber", { exact: true }).fill("2026-12-30")
  await expect(page.getByLabel("Vencimento da parcela 1", { exact: true })).toHaveValue("2026-12-30")
  await page.getByLabel("Vencimento da parcela 2", { exact: true }).fill("2027-02-02")
  await page.getByLabel("Forma da parcela 2", { exact: true }).selectOption(pix)

  await simulate(page)
  await expect(page.getByLabel("Vencimento da parcela 2", { exact: true })).toHaveValue("2027-02-02")
  await expect(page.getByLabel("Forma da parcela 2", { exact: true })).toHaveValue(pix)
  await expect(page.getByLabel("Observações da entrega", { exact: true })).toHaveValue("Entregar no galpão 2 com agendamento.")
  await page.getByRole("button", { name: "Adicionar parcela", exact: true }).click()
  await expect(page.getByLabel("Valor da parcela 4 (R$)", { exact: true })).toHaveValue("0,00")
  await page.getByRole("button", { name: "Remover parcela 4", exact: true }).click()
  await expect(page.getByLabel("Valor da parcela 4 (R$)", { exact: true })).toHaveCount(0)
  await expect(page.getByLabel("Vencimento da parcela 2", { exact: true })).toHaveValue("2027-02-02")

  await page.getByLabel("Entrada (%)", { exact: true }).fill("101")
  await page.getByLabel("Entrada (%)", { exact: true }).press("Tab")
  await page.getByRole("button", { name: "Criar pedido com estas condições", exact: true }).click()
  expect(state.writes.filter(write => write.pathname === "/api/erp/commercial/orders")).toHaveLength(0)
  await expect(page.getByRole("alert").filter({ hasText: "Confira o percentual" })).toBeVisible()
  await page.getByLabel("Entrada (%)", { exact: true }).fill("70,00")
  await page.getByLabel("Entrada (%)", { exact: true }).press("Tab")
  await expect(page.getByLabel("Entrada (R$)", { exact: true })).toHaveValue("15190,86")

  await page.getByLabel("Valor da parcela 2 (R$)", { exact: true }).fill("2170,11")
  await page.getByRole("button", { name: "Criar pedido com estas condições", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "a soma deve corresponder ao saldo" })).toBeVisible()
  expect(state.writes.filter(write => write.pathname === "/api/erp/commercial/orders")).toHaveLength(0)
  await page.getByLabel("Valor da parcela 3 (R$)", { exact: true }).fill("2170,12")
  await expect(page.getByText(/Parcelas:.*Soma conferida/)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`checkout-ready-${width}.png`), fullPage: true })
  await page.getByRole("button", { name: "Criar pedido com estas condições", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/vendas/pedidos/${record}$`))

  expect(state.creation()).toMatchObject({
    customerId: customer, dueDate: "2026-12-30", digest: "a".repeat(64), simulation: { line: "imported", versionId: version, downPaymentCents: 1519086 },
    checkout: {
      entry: { paymentMethodId: pix, dueOn: "2026-11-30" }, stateRegistration: "110042490114", manufacturingDays: 45,
      deliveryNotes: "Entregar no galpão 2 com agendamento.", paymentNotes: "Entrada por PIX e saldo conforme os vencimentos.", notes: "Conferir acesso para descarga.",
      installments: [
        { paymentMethodId: boleto, dueOn: "2026-12-30", amountCents: 217012 },
        { paymentMethodId: pix, dueOn: "2027-02-02", amountCents: 217011 },
        { paymentMethodId: boleto, dueOn: "2027-02-28", amountCents: 217012 },
      ],
    },
  })
  await expect(page.getByRole("heading", { name: "PV-000128", exact: true })).toBeVisible()
  const preservedCustomer = page.getByRole("region", { name: "Cliente do pedido", exact: true })
  await expect(preservedCustomer).toContainText("Academia Horizonte")
  await expect(preservedCustomer).toContainText("Marina da Academia")
  await expect(preservedCustomer).toContainText("Rua da Fundação")
  await expect(preservedCustomer).toContainText("110042490114")
  await expect.poll(state.changedPartyReads).toBeGreaterThan(0)
  await expect(preservedCustomer).not.toContainText("Rua Nova do Cadastro")
  await expect(page.getByRole("region", { name: "Entrega do pedido", exact: true })).toContainText("45 dias após o recebimento da entrada")
  const plan = page.getByRole("region", { name: "Plano de pagamento preservado", exact: true })
  await expect(plan).toContainText("R$ 21.701,21")
  const lines = plan.getByRole("listitem")
  await expect(lines).toHaveCount(4)
  await expect(lines.nth(0)).toContainText("Entrada prevista")
  await expect(lines.nth(0)).toContainText("R$ 15.190,86")
  await expect(lines.nth(0)).toContainText("PIX")
  await expect(lines.nth(0)).toContainText("30/11/2026")
  await expect(lines.nth(1)).toContainText("R$ 2.170,12")
  await expect(lines.nth(1)).toContainText("Boleto")
  await expect(lines.nth(2)).toContainText("R$ 2.170,11")
  await expect(lines.nth(2)).toContainText("PIX")
  await expect(lines.nth(2)).toContainText("02/02/2027")
  await expect(lines.nth(3)).toContainText("R$ 2.170,12")
  await expect(lines.nth(3)).toContainText("28/02/2027")
  await expect(plan).toContainText("Conferir acesso para descarga.")
  await expect(plan).not.toContainText("Entrada recebida")
  expect(state.writes.filter(write => write.pathname === "/api/erp/commercial/orders")).toHaveLength(1)
  expect(state.writes.every(write => ["/api/erp/commercial/simulate", "/api/erp/commercial/orders"].includes(write.pathname))).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`checkout-preserved-${width}.png`), fullPage: true })
})
