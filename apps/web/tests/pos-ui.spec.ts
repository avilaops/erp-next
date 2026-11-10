import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant } from "./helpers/frontend-fixture"

const sessionId = "22222222-2222-4222-8222-222222222222"
const productId = "33333333-3333-4333-8333-333333333333"
const cashId = "44444444-4444-4444-8444-444444444444"
const bankId = "55555555-5555-4555-8555-555555555555"
const saleId = "66666666-6666-4666-8666-666666666666"
const totals = { cash: "0.00", pix: "0.00", debit: "0.00", credit: "0.00", supplies: "0.00", withdrawals: "0.00", refunds: "0.00", expectedCash: "20.00", countedCash: null, difference: null }
const session = { id: sessionId, register: "Principal", cashAccountId: cashId, openingAmount: "20.00", status: "open", revision: 1, openedAt: "2026-11-09T12:00:00Z", closedAt: null, totals, sales: [], movements: [] }
const accounts = [{ id: cashId, code: "CX", name: "Caixa principal", accountType: "cash", status: "active" }, { id: bankId, code: "BAN", name: "Conta bancária", accountType: "bank", status: "active" }]

for (const width of [390, 1280]) test(`PDV registra pagamentos e troco e abre comprovante em ${width}px`, async ({ page, context }, info) => {
  await installFrontendFixture(context)
  await page.route("**/api/erp/company", route => route.fulfill({ json: { tenantId: tenant, data: { state: "SP" } } }))
  let current: typeof session | null = null
  let checkout: Record<string, unknown> | undefined
  let commands = 0
  await page.route("**/api/erp/financial-accounts?**", route => route.fulfill({ json: { tenantId: tenant, data: accounts, total: 2 } }))
  await page.route("**/api/erp/pos/sessions/current?**", route => route.fulfill({ headers: { ETag: `"${current?.revision || 0}"` }, json: { tenantId: tenant, canEdit: true, canClose: true, canCancel: true, data: current } }))
  await page.route("**/api/erp/pos/sessions", route => {
    expect(route.request().headers()["idempotency-key"]).toBeTruthy()
    expect(route.request().postDataJSON()).toEqual({ register: "Principal", cashAccountId: cashId, openingAmount: "20.00" })
    current = structuredClone(session)
    return route.fulfill({ status: 201, headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, canClose: true, canCancel: true, data: current } })
  })
  await page.route("**/api/erp/pos/products?**", route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: [{ id: productId, sku: "EQ-01", name: "Equipamento disponível", unit: "UN", unitPrice: "50.00", available: "10.000000", pricingAvailable: true }], total: 1, offset: 0, limit: 15 } }))
  await page.route(`**/api/erp/pos/sessions/${sessionId}/sales`, async route => {
    commands++
    expect(route.request().headers()["if-match"]).toBe('"1"')
    checkout = route.request().postDataJSON()
    const sale = { id: saleId, sessionId, status: "completed", total: "100.00", revision: 1, createdAt: "2026-11-09T12:10:00Z", items: [{ productId, sku: "EQ-01", name: "Equipamento disponível", quantity: "2.000000", unitPrice: "50.00", total: "100.00" }], payments: [{ method: "cash", accountId: cashId, amount: "40.00", tendered: "50.00", change: "10.00" }, { method: "pix", accountId: bankId, amount: "60.00", tendered: null, change: "0.00" }] }
    current = { ...structuredClone(session), revision: 2, totals: { ...totals, cash: "40.00", pix: "60.00", expectedCash: "60.00" }, sales: [sale] } as unknown as typeof session
    return route.fulfill({ status: 201, headers: { ETag: '"2"' }, json: { tenantId: tenant, canEdit: true, data: sale, session: current } })
  })
  await page.setViewportSize({ width, height: 900 })
  await page.goto("/vendas/pdv")
  await page.getByRole("combobox", { name: "Conta do caixa", exact: true }).selectOption(cashId)
  await page.getByLabel("Saldo de abertura (R$)", { exact: true }).fill("20,00")
  await page.getByRole("button", { name: "Abrir caixa", exact: true }).click()
  await page.getByRole("button", { name: "Adicionar Equipamento disponível", exact: true }).click()
  await page.getByLabel("Quantidade de Equipamento disponível", { exact: true }).fill("2")
  await page.getByLabel("Valor do pagamento 1 (R$)", { exact: true }).fill("40,00")
  await page.getByLabel("Recebido em dinheiro 1 (R$)", { exact: true }).fill("50,00")
  await page.getByRole("button", { name: "Adicionar pagamento", exact: true }).click()
  await page.getByLabel("Forma de pagamento 2", { exact: true }).selectOption("pix")
  await page.getByLabel("Conta de recebimento 2", { exact: true }).selectOption(bankId)
  await page.getByLabel("Valor do pagamento 2 (R$)", { exact: true }).fill("60,00")
  await page.getByRole("button", { name: "Concluir venda", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Comprovante de venda", exact: true })).toBeVisible()
  expect(commands).toBe(1)
  expect(checkout).toMatchObject({ expectedTotal: "100.00", items: [{ productId, quantity: "2.000000" }], payments: [{ method: "cash", amount: "40.00", tendered: "50.00" }, { method: "pix", amount: "60.00", accountId: bankId }] })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`pos-receipt-${width}.png`), fullPage: true })
})

test("fechamento confere diferença e histórico preserva o caixa encerrado", async ({ page, context }, info) => {
  await installFrontendFixture(context)
  const closed = { ...session, status: "closed", revision: 2, closedAt: "2026-11-09T13:00:00Z", totals: { ...totals, countedCash: "18.00", difference: "-2.00" } }
  let closing: unknown
  await page.route(`**/api/erp/pos/sessions/${sessionId}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, canClose: true, data: session } }))
  await page.route(`**/api/erp/pos/sessions/${sessionId}/close`, route => {
    closing = route.request().postDataJSON()
    return route.fulfill({ headers: { ETag: '"2"' }, json: { tenantId: tenant, canEdit: true, data: closed } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/vendas/pdv/fechamento?caixa=${sessionId}`)
  await page.getByLabel("Dinheiro contado (R$)", { exact: true }).fill("18,00")
  await page.getByLabel("Justificativa da diferença", { exact: true }).fill("Conferência de numerário")
  await page.getByRole("button", { name: "Confirmar fechamento", exact: true }).click()
  expect(closing).toEqual({ countedCash: "18.00", reason: "Conferência de numerário" })
  await expect(page.getByText("Caixa fechado", { exact: true })).toBeVisible()
  await page.route("**/api/erp/pos/sessions?**", route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: [closed], total: 1, offset: 0, limit: 20 } }))
  await page.goto("/vendas/pdv/historico")
  await expect(page.getByRole("table", { name: "Histórico dos caixas" })).toBeVisible()
  await expect(page.getByRole("cell", { name: "Fechado", exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath("pos-history-mobile.png"), fullPage: true })
})
