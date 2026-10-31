import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

const seller = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const original = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const reversal = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const payment = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const balance = { sellerStaffId: seller, sellerName: "Maria", revision: 4, openAmount: "-2.50", paidAmount: "2.50" }
const entries = [
  { id: original, kind: "receipt", sellerName: "Maria original", orderId: record, receiptId: original, reversesEntryId: null, competence: "2026-10", paymentDue: "2026-11-10", amount: "2.50", baseAmount: "50.00", commissionRate: "5.0000", ipiRate: "10.0000", reason: "Comissão sobre recebimento", paymentId: payment },
  { id: reversal, kind: "reversal", sellerName: "Maria original", orderId: record, receiptId: null, reversesEntryId: original, competence: "2026-11", paymentDue: "2026-12-10", amount: "-2.50", baseAmount: "-50.00", commissionRate: "5.0000", ipiRate: "10.0000", reason: "Cancelamento integral conferido", paymentId: null },
]
const payments = [{ id: payment, amount: "2.50", throughCompetence: "2026-10", occurredOn: "2026-11-10", reference: "Comissão de outubro paga" }]

test.beforeEach(async ({ context }) => installFrontendFixture(context))

test("comissões mostram valores reais e preservam o pagamento anterior ao estorno", async ({ page }) => {
  await page.route("**/api/erp/commissions?*", route => route.fulfill({ json: { tenantId: tenant, canEdit: false, data: [balance], total: 1, totals: { openAmount: "-2.50", paidAmount: "2.50" } } }))
  await page.route(`**/api/erp/commissions/${seller}`, route => route.fulfill({ headers: { ETag: '"4"' }, json: { tenantId: tenant, canEdit: false, data: balance, entries, payments } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/financeiro/comissoes")
  await page.getByRole("button", { name: "Consultar comissões de Maria", exact: true }).click()
  const book = page.getByRole("region", { name: "Livro de comissões", exact: true })
  await expect(book.getByText("Estorno · R$ -2,50", { exact: true })).toBeVisible()
  await expect(book.getByText("Comissão de outubro paga", { exact: true })).toBeVisible()
  await expect(book.getByText("Competência: 2026-11 · Vencimento: 2026-12-10", { exact: true })).toBeVisible()
  await expect(book.getByText("Vendedor registrado: Maria original", { exact: true })).toHaveCount(2)
  await expect(book.getByText("Incluído em pagamento declarado", { exact: true })).toBeVisible()
  await expect(book.getByText("Somente consulta.", { exact: true })).toBeVisible()
  await expect(book.getByRole("button", { name: "Confirmar pagamento da comissão", exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("ajuste preserva motivo e repete o mesmo comando após confirmação interrompida", async ({ page }) => {
  const calls: { key: string; revision: string; body: unknown }[] = []
  let adjusted = false
  await page.route("**/api/erp/commissions?*", route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: [balance], total: 1, totals: { openAmount: adjusted ? "1.50" : "-2.50", paidAmount: "2.50" } } }))
  await page.route(`**/api/erp/commissions/${seller}`, route => route.fulfill({ headers: { ETag: adjusted ? '"5"' : '"4"' }, json: { tenantId: tenant, canEdit: true, data: { ...balance, revision: adjusted ? 5 : 4, openAmount: adjusted ? "1.50" : "-2.50" }, entries, payments } }))
  await page.route(`**/api/erp/commissions/${seller}/adjustments`, route => {
    calls.push({ key: route.request().headers()["idempotency-key"], revision: route.request().headers()["if-match"], body: route.request().postDataJSON() })
    adjusted = true
    return calls.length === 1 ? route.abort("failed") : route.fulfill({ headers: { ETag: '"5"' }, status: 201, json: { tenantId: tenant, canEdit: true, data: { ...balance, revision: 5, openAmount: "1.50" }, entries, payments } })
  })
  await page.goto("/financeiro/comissoes")
  await page.getByRole("button", { name: "Consultar comissões de Maria", exact: true }).click()
  await page.getByRole("combobox", { name: "Operação de comissão", exact: true }).selectOption("adjustments")
  await page.getByLabel("Competência do ajuste", { exact: true }).fill("2026-12")
  await page.getByLabel("Valor do ajuste (negativo para débito)", { exact: true }).fill("4,00")
  await page.getByLabel("Dia de pagamento do ajuste", { exact: true }).fill("10")
  await page.getByLabel("Motivo do ajuste de comissão", { exact: true }).fill("Complemento administrativo conferido")
  await page.getByRole("button", { name: "Confirmar ajuste da comissão", exact: true }).click()
  await expect(page.getByLabel("Motivo do ajuste de comissão", { exact: true })).toBeDisabled()
  await expect(page.getByLabel("Motivo do ajuste de comissão", { exact: true })).toHaveValue("Complemento administrativo conferido")
  await page.getByRole("button", { name: "Repetir confirmação da comissão", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Ajuste de comissão registrado." })).toBeVisible()
  expect(calls).toHaveLength(2)
  expect(calls[0]).toEqual(calls[1])
  expect(calls[0]).toMatchObject({ revision: '"4"', body: { amount: "4.00", competence: "2026-12", paymentDay: 10, reason: "Complemento administrativo conferido" } })
  expect(calls[0].key).toMatch(/^[0-9a-f-]{36}$/)
})

test("comissões recusadas pelo servidor não exibem dados demonstrativos", async ({ page }) => {
  await page.route("**/api/erp/commissions?*", route => route.fulfill({ status: 403, json: { title: "Sem permissão de comissões" } }))
  await page.goto("/financeiro/comissoes")
  await expect(page.getByRole("alert").filter({ hasText: "Sem permissão de comissões" })).toBeVisible()
  await expect(page.getByText("Saldo em aberto", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /Consultar comissões de/ })).toHaveCount(0)
})

test("comissão do pedido exige condições explícitas e conserva o snapshot após confirmação", async ({ page }) => {
  let configured = false
  let confirmed = false
  const calls: unknown[] = []
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["finance.commissions.read", "finance.commissions.manage", "sales.orders.read", "sales.orders.manage", "catalog.staff.read"] } }))
  await page.route(`**/api/erp/orders/${record}`, route => route.fulfill({ headers: { ETag: confirmed ? '"3"' : configured ? '"2"' : '"1"' }, json: { tenantId: tenant, canEdit: true, data: { id: record, customerName: "Cliente da comissão", status: confirmed ? "confirmed" : "draft", revision: confirmed ? 3 : configured ? 2 : 1, amount: "110.00", dueDate: "2026-11-01" }, items: [] } }))
  await page.route("**/api/erp/staff?*", route => route.fulfill({ json: { tenantId: tenant, data: [{ id: seller, name: "Maria" }], total: 1 } }))
  await page.route(`**/api/erp/orders/${record}/commission`, route => {
    if (route.request().method() === "PUT") {
      calls.push(route.request().postDataJSON())
      expect(route.request().headers()["if-match"]).toBe('"1"')
      expect(route.request().headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/)
      configured = true
    }
    return route.fulfill({ headers: { ETag: confirmed ? '"3"' : configured ? '"2"' : '"1"' }, json: { tenantId: tenant, canEdit: !confirmed, data: { orderId: record, revision: confirmed ? 3 : configured ? 2 : 1, status: configured ? "configured" : "not_required", locked: confirmed, sellerStaffId: configured ? seller : null, sellerName: configured ? "Maria" : null, commissionRate: configured ? "5.0000" : null, ipiRate: configured ? "10.0000" : null, paymentDay: configured ? 10 : null } } })
  })
  await page.goto(`/vendas/pedidos/${record}`)
  await expect(page.getByLabel("Comissão percentual", { exact: true })).toHaveValue("")
  await expect(page.getByLabel("IPI percentual da comissão", { exact: true })).toHaveValue("")
  await expect(page.getByLabel("Dia do pagamento da comissão", { exact: true })).toHaveValue("")
  await page.getByRole("combobox", { name: "Vendedor da comissão", exact: true }).selectOption(seller)
  await page.getByLabel("Comissão percentual", { exact: true }).fill("5,0000")
  await page.getByLabel("IPI percentual da comissão", { exact: true }).fill("10,0000")
  await page.getByLabel("Dia do pagamento da comissão", { exact: true }).fill("10")
  await page.getByRole("button", { name: "Salvar comissão do pedido", exact: true }).click()
  await expect(page.getByLabel("Comissão percentual", { exact: true })).toHaveValue("5.0000")
  expect(calls).toEqual([{ sellerStaffId: seller, commissionRate: "5.0000", ipiRate: "10.0000", paymentDay: 10 }])
  confirmed = true
  await page.reload()
  await expect(page.getByText("Vendedor: Maria", { exact: true })).toBeVisible()
  await expect(page.getByText("Comissão: 5,0000% · IPI: 10,0000% · Pagamento: dia 10 do mês seguinte.", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Salvar comissão do pedido", exact: true })).toHaveCount(0)
})
