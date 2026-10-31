import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

const receiptId = "33333333-3333-4333-8333-333333333333"
const reversalId = "44444444-4444-4444-8444-444444444444"
const productId = "55555555-5555-4555-8555-555555555555"
const reason = "Devolução integral conferida pela equipe"
const occurredOn = "2026-10-31"
const permissions = ["sales.orders.manage", "purchasing.orders.manage", "inventory.stock.manage", "finance.receivables.manage", "finance.payables.manage"]
type Command = { key: string; revision: string; body: unknown }

test.beforeEach(async ({ context }) => installFrontendFixture(context))

test("cancelamento integral repete o mesmo comando após resposta perdida e mostra histórico", async ({ page }) => {
  let cancelled = false
  const calls: Command[] = []
  const dialogs: string[] = []
  page.on("dialog", dialog => { dialogs.push(dialog.message()); void dialog.accept() })
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions } }))
  await page.route(`**/api/erp/orders/${record}`, route => route.fulfill({ headers: { ETag: cancelled ? '"4"' : '"3"' }, json: { tenantId: tenant, canEdit: true, data: { id: record, customerName: "Cliente devolução", status: cancelled ? "cancelled" : "completed", revision: cancelled ? 4 : 3, amount: "20.00", dueDate: "2026-11-01" }, items: [] } }))
  await page.route(`**/api/erp/orders/${record}/cancel-completed`, route => {
    calls.push({ key: route.request().headers()["idempotency-key"], revision: route.request().headers()["if-match"], body: route.request().postDataJSON() })
    cancelled = true
    return calls.length === 1 ? route.abort("failed") : route.fulfill({ headers: { ETag: '"4"' }, json: { tenantId: tenant, data: { id: reversalId, revision: 4 } } })
  })
  await page.route(`**/api/erp/orders/${record}/cancellations`, route => route.fulfill({ json: { tenantId: tenant, data: [{ id: reversalId, reason, occurredOn, revision: 4 }] } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/vendas/pedidos/${record}`)
  await page.getByLabel("Motivo do cancelamento integral", { exact: true }).fill(reason)
  await page.getByLabel("Data do cancelamento integral", { exact: true }).fill(occurredOn)
  await page.getByRole("button", { name: "Confirmar cancelamento integral", exact: true }).click()
  await expect(page.getByLabel("Motivo do cancelamento integral", { exact: true })).toBeDisabled()
  await expect(page.getByLabel("Data do cancelamento integral", { exact: true })).toHaveValue(occurredOn)
  await page.getByRole("button", { name: "Conferir cancelamento integral", exact: true }).click()
  await expect(page.getByText("Situação: Cancelado", { exact: true })).toBeVisible()
  expect(calls).toHaveLength(2)
  expect(calls[0]).toEqual(calls[1])
  expect(calls[0]).toMatchObject({ revision: '"3"', body: { reason, occurredOn } })
  expect(calls[0].key).toMatch(/^[0-9a-f-]{36}$/)
  expect(dialogs).toHaveLength(1)
  expect(dialogs[0]).toContain("estoque")
  await page.getByRole("button", { name: "Consultar histórico de cancelamento", exact: true }).click()
  await expect(page.getByText(reason, { exact: true })).toBeVisible()
  await expect(page.getByLabel("Motivo do cancelamento integral", { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("estorno do recebimento usa revisão da compra e conserva motivo e chave durante incerteza", async ({ page }) => {
  let reversed = false
  const calls: Command[] = []
  page.on("dialog", dialog => dialog.accept())
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions } }))
  await page.route(`**/api/erp/purchase-orders/${record}`, route => route.fulfill({ headers: { ETag: reversed ? '"5"' : '"4"' }, json: { tenantId: tenant, canEdit: true, data: { id: record, status: reversed ? "confirmed" : "received", revision: reversed ? 5 : 4 }, items: [{ productId, name: "Produto devolvido" }] } }))
  await page.route(`**/api/erp/purchase-receipts/${receiptId}`, route => route.fulfill({ json: { tenantId: tenant, data: { id: receiptId, orderId: record, reference: "REC-001", occurredOn: "2026-10-30", amount: "20.00", payableId: null, orderRevision: reversed ? 5 : 4, reversalId: reversed ? reversalId : null }, items: [{ productId, unit: "UN", quantity: "2.000000", amount: "20.00" }] } }))
  await page.route(`**/api/erp/purchase-receipts/${receiptId}/reverse`, route => {
    calls.push({ key: route.request().headers()["idempotency-key"], revision: route.request().headers()["if-match"], body: route.request().postDataJSON() })
    reversed = true
    return calls.length === 1 ? route.fulfill({ status: 503, json: { title: "Confirmação interrompida" } }) : route.fulfill({ headers: { ETag: '"5"' }, json: { tenantId: tenant, data: { id: reversalId, revision: 5 } } })
  })
  await page.route(`**/api/erp/purchase-receipts/${receiptId}/reversals`, route => route.fulfill({ json: { tenantId: tenant, data: [{ id: reversalId, reason, occurredOn, revision: 5 }] } }))
  await page.goto(`/compras/recebimentos/${receiptId}`)
  await page.getByLabel("Motivo do estorno do recebimento", { exact: true }).fill(reason)
  await page.getByLabel("Data do estorno do recebimento", { exact: true }).fill(occurredOn)
  await page.getByRole("button", { name: "Confirmar estorno integral do recebimento", exact: true }).click()
  await expect(page.getByLabel("Motivo do estorno do recebimento", { exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Conferir estorno do recebimento", exact: true }).click()
  await expect(page.getByText("Situação: Estornado", { exact: true })).toBeVisible()
  expect(calls).toHaveLength(2)
  expect(calls[0]).toEqual(calls[1])
  expect(calls[0]).toMatchObject({ revision: '"4"', body: { reason, occurredOn } })
  await page.getByRole("button", { name: "Consultar histórico de estornos", exact: true }).click()
  await expect(page.getByText(reason, { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Confirmar estorno integral do recebimento", exact: true })).toHaveCount(0)
})

test("cancelamento integral exige permissões atuais de estoque e financeiro", async ({ page }) => {
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["sales.orders.manage"] } }))
  await page.route(`**/api/erp/orders/${record}`, route => route.fulfill({ headers: { ETag: '"3"' }, json: { tenantId: tenant, canEdit: true, data: { id: record, customerName: "Cliente consulta", status: "completed", revision: 3, amount: "20.00", dueDate: "2026-11-01" }, items: [] } }))
  await page.goto(`/vendas/pedidos/${record}`)
  await expect(page.getByText("O cancelamento integral exige permissões de vendas, estoque e contas a receber.", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Motivo do cancelamento integral", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Consultar histórico de cancelamento", exact: true })).toBeVisible()
})

test("títulos cancelados preservam consulta e histórico sem oferecer nova baixa", async ({ page }) => {
  for (const area of ["receivables", "payables"]) {
    await page.route(`**/api/erp/${area}/${record}`, route => route.fulfill({ headers: { ETag: '"5"' }, json: { tenantId: tenant, canEdit: true, data: { id: record, orderId: record, receiptId, customerName: "Cliente devolução", supplierName: "Fornecedor devolução", status: "cancelled", revision: 5, amount: "20.00", paidAmount: "0.00", receivedAmount: "0.00", outstandingAmount: "0.00", dueDate: "2026-11-01", paymentId: null }, payments: [] } }))
    await page.goto(`/financeiro/${area === "receivables" ? "contas-receber" : "contas-pagar"}/${record}`)
    await expect(page.getByText("Situação: Cancelado", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: /Confirmar (recebimento|pagamento) declarado/ })).toHaveCount(0)
    await expect(page.getByRole("heading", { name: area === "receivables" ? "Histórico de recebimentos" : "Histórico de pagamentos", exact: true })).toBeVisible()
  }
})
