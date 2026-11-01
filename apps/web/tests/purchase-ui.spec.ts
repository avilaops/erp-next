import { expect, test } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"
import type { PurchaseDetail, ReceiptDetail } from "../src/features/purchasing/purchase-types"

// These responses verify browser/BFF behavior. Rust/PostgreSQL tests own transactional effects.
test.setTimeout(45_000)
const origin = "http://127.0.0.1:33118"
const secret = "danfe-browser-fixture-not-a-real-service-secret"
const tenant = "11111111-1111-4111-8111-111111111111"
const orderId = "22222222-2222-4222-8222-222222222222"
const productId = "33333333-3333-4333-8333-333333333333"
const supplierId = "44444444-4444-4444-8444-444444444444"
const receiptId = "55555555-5555-4555-8555-555555555555"
const payableId = "66666666-6666-4666-8666-666666666666"
const paymentId = "77777777-7777-4777-8777-777777777777"
const product = { id: productId, name: "Produto da compra", sku: "COMPRA-001", unit: "UN", basePrice: "99.99" }
type Payment = { id: string; kind: string; amount: string; method: string; reference: string; occurredOn: string; reversesId: string | null }
type Payable = { tenantId: string; canEdit: boolean; data: { id: string; receiptId: string; supplierName: string; dueDate: string; amount: string; paidAmount: string; outstandingAmount: string; status: string; revision: number }; payments: Payment[] }
type Call = { method: string; path: string; body: unknown; key?: string; revision?: string }
type Plan = { method: string; path: string; status: number; response: object; revision?: number; apply?: () => void }
let order: PurchaseDetail | null
let receipts: ReceiptDetail[]
let payable: Payable | null
let canEdit: boolean
let permissions: string[]
let plans: Plan[]
let calls: Call[]
let failures: string[]
let requests: string[]
function draft(revision = 1): PurchaseDetail {
  return { tenantId: tenant, canEdit, data: { id: orderId, supplierId, supplierName: "Fornecedor da compra", supplierTaxId: "19131243000197", dueDate: "2026-11-20", amount: "6.50", status: "draft", revision }, items: [{ productId, name: product.name, sku: product.sku, unit: "UN", quantity: "2.000000", receivedQuantity: "0.000000", unitCost: "3.25", amount: "6.50" }], receiptCount: 0 }
}
function initialPayable(): Payable {
  return { tenantId: tenant, canEdit, data: { id: payableId, receiptId, supplierName: "Fornecedor da compra", dueDate: "2026-11-20", amount: "4.00", paidAmount: "0.00", outstandingAmount: "4.00", status: "open", revision: 1 }, payments: [] }
}
const upstream = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json")
  try {
    expect(request.headers.authorization).toBe("Bearer purchase-fixture-token")
    expect(request.headers["x-tenant-id"]).toBe(tenant)
    const url = new URL(request.url!, "http://fixture.invalid")
    requests.push(request.method + " " + url.pathname + url.search)
    let body = ""; for await (const chunk of request) body += chunk
    if (request.method !== "GET") {
      const call = { method: request.method!, path: url.pathname, body: JSON.parse(body), key: request.headers["idempotency-key"] as string, revision: request.headers["if-match"] as string }
      calls.push(call)
      expect(call.key).toMatch(/^[0-9a-f-]{36}$/)
      const plan = plans.shift()
      expect(plan, `Unexpected ${call.method} ${call.path}`).toBeTruthy()
      expect(call.method).toBe(plan!.method); expect(call.path).toBe(plan!.path)
      plan!.apply?.()
      response.statusCode = plan!.status
      if (plan!.revision) response.setHeader("ETag", `"${plan!.revision}"`)
      response.end(JSON.stringify(plan!.response)); return
    }
    if (url.pathname === "/api/v1/me") { response.end(JSON.stringify({ tenant: { id: tenant, legalName: "Empresa fixture" }, permissions })); return }
    if (url.pathname === "/api/v1/parties") {
      expect(url.searchParams.get("role")).toBe("supplier")
      response.end(JSON.stringify({ tenantId: tenant, canEdit, total: 1, data: [{ id: supplierId, legalName: "Fornecedor da compra" }] })); return
    }
    if (url.pathname === "/api/v1/products") { response.end(JSON.stringify({ tenantId: tenant, canEdit, total: 1, data: [product] })); return }
    if (url.pathname === "/api/v1/purchase-orders") { response.end(JSON.stringify({ tenantId: tenant, canEdit, total: order ? 1 : 0, data: order ? [order.data] : [] })); return }
    if (url.pathname === `/api/v1/purchase-orders/${orderId}/receipts`) { response.end(JSON.stringify({ tenantId: tenant, total: receipts.length, data: receipts.map(item => item.data) })); return }
    if (url.pathname === `/api/v1/purchase-orders/${orderId}` && order) { response.setHeader("ETag", `"${order.data.revision}"`); response.end(JSON.stringify({ ...order, canEdit })); return }
    if (url.pathname === `/api/v1/purchase-receipts/${receiptId}` && receipts[0]) { response.end(JSON.stringify(receipts[0])); return }
    if (url.pathname === "/api/v1/payables") { response.end(JSON.stringify({ tenantId: tenant, canEdit, total: payable ? 1 : 0, data: payable ? [payable.data] : [] })); return }
    if (url.pathname === `/api/v1/payables/${payableId}` && payable) { response.setHeader("ETag", `"${payable.data.revision}"`); response.end(JSON.stringify({ ...payable, canEdit })); return }
    response.statusCode = 404; response.end(JSON.stringify({ title: "Registro não encontrado" }))
  } catch (error) { failures.push(String(error)); response.statusCode = 500; response.end(JSON.stringify({ title: "Contrato fixture divergente" })) }
})
function cookie() {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "purchase-fixture-token", tenantId: tenant, expiresAt: Date.now() + 3600_000 })), cipher.final()])
  return { name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" as const }
}
test.beforeAll(async () => { await new Promise<void>(resolve => upstream.listen(33119, "127.0.0.1", resolve)) })
test.afterAll(async () => { await new Promise<void>(resolve => upstream.close(() => resolve())) })
test.beforeEach(() => { order = null; payable = null; receipts = []; canEdit = true; permissions = ["purchasing.receipts.create", "inventory.stock.manage", "finance.payables.originate"]; plans = []; calls = []; failures = []; requests = [] })
test.afterEach(() => { expect(failures).toEqual([]); expect(plans).toEqual([]) })

test("purchase BFF rejects anonymous, foreign-origin, changed-company and unsupported requests before upstream", async ({ context }) => {
  expect((await context.request.get("/api/erp/purchase-orders")).status()).toBe(401)
  await context.addCookies([cookie()])
  const post = (path: string, headers = {}) => context.request.post(path, { headers: { Origin: origin, "X-Tenant-Id": tenant, ...headers }, data: {} })
  expect((await post("/api/erp/purchase-orders", { Origin: "https://foreign.invalid" })).status()).toBe(403)
  expect((await post(`/api/erp/purchase-orders/${orderId}/receipts`, { "X-Tenant-Id": supplierId })).status()).toBe(409)
  expect((await post(`/api/erp/purchase-orders/${orderId}/complete`)).status()).toBe(404)
  expect((await post(`/api/erp/payables/${payableId}/delete`)).status()).toBe(404)
  expect((await context.request.get("/api/erp/purchase-orders?limit=1&limit=2")).status()).toBe(400)
  expect((await context.request.get("/api/erp/payables?tenant=other")).status()).toBe(400)
  expect(requests).toEqual([])
  await context.request.get("/api/erp/purchase-orders?offset=25&limit=25")
  expect(requests).toEqual(["GET /api/v1/purchase-orders?offset=25&limit=25"])
})

test("browser creates and edits a purchase, receives a partial delivery and records and reverses a partial payment", async ({ page, context }, testInfo) => {
  await context.addCookies([cookie()])
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  page.on("dialog", dialog => dialog.accept())
  await page.goto("/compras/pedidos/novo")
  await page.getByRole("button", { name: "Selecionar Fornecedor da compra", exact: true }).click()
  await page.getByRole("button", { name: "Selecionar Produto da compra · COMPRA-001", exact: true }).click()
  await expect(page.getByLabel("Custo unitário de Produto da compra", { exact: true }).filter({ visible: true })).toHaveValue("")
  await page.getByLabel("Quantidade de Produto da compra", { exact: true }).filter({ visible: true }).fill("2,000000")
  await page.getByLabel("Custo unitário de Produto da compra", { exact: true }).filter({ visible: true }).fill("3,25")
  await page.getByLabel("Vencimento da compra", { exact: true }).filter({ visible: true }).fill("2026-11-20")
  await expect(page.getByText("Total previsto: R$ 6,50", { exact: true })).toBeVisible()
  const created = draft()
  plans.push({ method: "POST", path: "/api/v1/purchase-orders", status: 201, response: created, revision: 1, apply: () => { order = created } })
  await page.getByRole("button", { name: "Criar rascunho de compra", exact: true }).click()
  await page.getByRole("link", { name: "Editar rascunho", exact: true }).click()
  expect(calls[0].body).toEqual({ supplierId, dueDate: "2026-11-20", items: [{ productId, quantity: "2.000000", unitCost: "3.25" }] })
  await expect(page.getByLabel("Custo unitário de Produto da compra", { exact: true }).filter({ visible: true })).toHaveValue("3.25")
  await page.getByLabel("Custo unitário de Produto da compra", { exact: true }).filter({ visible: true }).fill("4.00")
  const edited = { ...created, data: { ...created.data, revision: 2, amount: "8.00" }, items: [{ ...created.items[0], unitCost: "4.00", amount: "8.00" }] }
  plans.push({ method: "PUT", path: `/api/v1/purchase-orders/${orderId}`, status: 200, response: edited, revision: 2, apply: () => { order = edited } })
  await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click()
  const confirmed = { ...edited, data: { ...edited.data, status: "confirmed", revision: 3 } }
  plans.push({ method: "POST", path: `/api/v1/purchase-orders/${orderId}/confirm`, status: 200, response: confirmed, revision: 3, apply: () => { order = confirmed } })
  await page.getByRole("button", { name: "Confirmar pedido de compra", exact: true }).click()
  await page.getByLabel("Referência do recebimento", { exact: true }).filter({ visible: true }).fill("REC-001")
  await page.getByLabel("Data do recebimento", { exact: true }).filter({ visible: true }).fill("2026-10-28")
  await page.getByLabel("Receber Produto da compra", { exact: false }).filter({ visible: true }).fill("1")
  const receipt: ReceiptDetail = { tenantId: tenant, data: { id: receiptId, orderId, reference: "REC-001", occurredOn: "2026-10-28", amount: "4.00", payableId, orderRevision: 4, reversalId: null }, items: [{ productId, quantity: "1.000000", unit: "UN", amount: "4.00" }] }
  const received = { ...confirmed, data: { ...confirmed.data, status: "partially_received", revision: 4 }, items: [{ ...confirmed.items[0], receivedQuantity: "1.000000" }], receiptCount: 1 }
  plans.push({ method: "POST", path: `/api/v1/purchase-orders/${orderId}/receipts`, status: 201, response: { order: received, receipt, payableId }, revision: 4, apply: () => { order = received; receipts = [receipt]; payable = initialPayable() } })
  await page.getByRole("button", { name: "Registrar entrada e conta a pagar", exact: true }).click()
  await expect(page.getByText("Situação: Recebido parcialmente", { exact: true })).toBeVisible()
  expect(calls[3]).toMatchObject({ revision: '"3"', body: { reference: "REC-001", occurredOn: "2026-10-28", items: [{ productId, quantity: "1.000000" }] } })
  await page.getByRole("link", { name: "Consultar conta a pagar", exact: true }).click()
  await page.getByLabel("Valor do pagamento", { exact: true }).filter({ visible: true }).fill("3.00")
  await page.getByLabel("Data do pagamento", { exact: true }).filter({ visible: true }).fill("2026-10-28")
  await page.getByLabel("Referência do pagamento", { exact: true }).filter({ visible: true }).fill("PAG-001")
  const payment: Payment = { id: paymentId, kind: "payment", amount: "3.00", method: "bank_transfer", reference: "PAG-001", occurredOn: "2026-10-28", reversesId: null }
  const partial: Payable = { ...initialPayable(), data: { ...initialPayable().data, paidAmount: "3.00", outstandingAmount: "1.00", revision: 2 }, payments: [payment] }
  plans.push({ method: "POST", path: `/api/v1/payables/${payableId}/payments`, status: 200, response: partial, revision: 2, apply: () => { payable = partial } })
  await page.getByRole("button", { name: "Confirmar pagamento declarado", exact: true }).click()
  await expect(page.getByText("Saldo restante: R$ 1,00", { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 375, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath("conta-a-pagar-mobile.png"), fullPage: true })
  await page.getByRole("button", { name: "Estornar pagamento PAG-001", exact: true }).click()
  await page.getByLabel("Motivo do estorno", { exact: true }).filter({ visible: true }).fill("Correção do registro")
  await page.getByLabel("Data do estorno", { exact: true }).filter({ visible: true }).fill("2026-10-28")
  const reversed = { ...initialPayable(), data: { ...initialPayable().data, revision: 3 }, payments: [payment, { ...payment, id: "88888888-8888-4888-8888-888888888888", kind: "reversal", reference: "Correção do registro", reversesId: paymentId }] }
  plans.push({ method: "POST", path: `/api/v1/payables/${payableId}/reverse-payment`, status: 200, response: reversed, revision: 3, apply: () => { payable = reversed } })
  await page.getByRole("button", { name: "Confirmar estorno do pagamento", exact: true }).click()
  await expect(page.getByText("Saldo restante: R$ 4,00", { exact: true })).toBeVisible()
  await expect(page.getByText("Estorno vinculado ao pagamento original.", { exact: true })).toBeVisible()
  expect(calls[5]).toMatchObject({ revision: '"2"', body: { paymentId, reason: "Correção do registro", occurredOn: "2026-10-28" } })
  expect(errors).toEqual([])
  expect(await page.content()).not.toContain("purchase-fixture-token")
})

test("ambiguous purchase creation repeats the same key and stale edits preserve input until explicit reload", async ({ page, context }) => {
  await context.addCookies([cookie()]); page.on("dialog", dialog => dialog.accept())
  await page.goto("/compras/pedidos/novo")
  await page.getByRole("button", { name: "Selecionar Fornecedor da compra", exact: true }).click()
  await page.getByRole("button", { name: "Selecionar Produto da compra · COMPRA-001", exact: true }).click()
  await page.getByLabel("Quantidade de Produto da compra", { exact: true }).filter({ visible: true }).fill("2")
  await page.getByLabel("Custo unitário de Produto da compra", { exact: true }).filter({ visible: true }).fill("3.25")
  await page.getByLabel("Vencimento da compra", { exact: true }).filter({ visible: true }).fill("2026-11-20")
  plans.push({ method: "POST", path: "/api/v1/purchase-orders", status: 503, response: { title: "Confirmação indisponível" } })
  await page.getByRole("button", { name: "Criar rascunho de compra", exact: true }).click()
  await expect(page.getByLabel("Custo unitário de Produto da compra", { exact: true }).filter({ visible: true })).toBeDisabled()
  const created = draft()
  plans.push({ method: "POST", path: "/api/v1/purchase-orders", status: 201, response: created, revision: 1, apply: () => { order = created } })
  await page.getByRole("button", { name: "Conferir gravação da compra", exact: true }).click()
  await page.getByRole("link", { name: "Editar rascunho", exact: true }).click()
  expect(calls[0]).toEqual(calls[1])
  await page.getByLabel("Custo unitário de Produto da compra", { exact: true }).filter({ visible: true }).fill("8.00")
  plans.push({ method: "PUT", path: `/api/v1/purchase-orders/${orderId}`, status: 412, response: { title: "Outra pessoa alterou a compra" } })
  await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Outra pessoa alterou" })).toContainText("Outra pessoa alterou")
  await expect(page.getByLabel("Custo unitário de Produto da compra", { exact: true }).filter({ visible: true })).toHaveValue("8.00")
  await expect(page.getByRole("button", { name: "Salvar rascunho", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Recarregar compra", exact: true }).click()
  await expect(page.getByLabel("Custo unitário de Produto da compra", { exact: true }).filter({ visible: true })).toHaveValue("3.25")
})

test("receipt permissions are independent from purchase editing and readonly payables do not offer settlement", async ({ page, context }) => {
  await context.addCookies([cookie()])
  order = { ...draft(), data: { ...draft().data, status: "confirmed" } }
  permissions = []
  await page.goto(`/compras/pedidos/${orderId}`)
  await expect(page.getByText("O recebimento exige permissões", { exact: false })).toBeVisible()
  await expect(page.getByRole("button", { name: "Registrar entrada e conta a pagar", exact: true })).toHaveCount(0)
  permissions = ["purchasing.receipts.create", "inventory.stock.manage", "finance.payables.originate"]
  canEdit = false
  await page.reload()
  await expect(page.getByRole("button", { name: "Registrar entrada e conta a pagar", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Cancelar compra", exact: true })).toHaveCount(0)
  payable = initialPayable()
  await page.goto(`/financeiro/contas-pagar/${payableId}`)
  await expect(page.getByText("Somente consulta.", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Valor do pagamento", { exact: true }).filter({ visible: true })).toHaveCount(0)
  await page.goto("/compras/pedidos/novo")
  await expect(page.getByRole("status")).toContainText("Somente consulta")
  await expect(page.getByLabel("Vencimento da compra", { exact: true }).filter({ visible: true })).toHaveCount(0)
})

test("receiving rejects excess quantities locally, retries the same command and closes only the remaining balance", async ({ page, context }) => {
  await context.addCookies([cookie()]); page.on("dialog", dialog => dialog.accept())
  order = { ...draft(), data: { ...draft().data, status: "confirmed", revision: 2 } }
  await page.goto(`/compras/pedidos/${orderId}`)
  await page.getByLabel("Referência do recebimento", { exact: true }).filter({ visible: true }).fill("ENTREGA-002")
  await page.getByLabel("Data do recebimento", { exact: true }).filter({ visible: true }).fill("2026-10-28")
  await page.getByLabel("Receber Produto da compra", { exact: false }).filter({ visible: true }).fill("3")
  await page.getByRole("button", { name: "Registrar entrada e conta a pagar", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "até 2.000000" })).toContainText("até 2.000000")
  expect(calls).toEqual([])
  await page.getByLabel("Receber Produto da compra", { exact: false }).filter({ visible: true }).fill("1")
  plans.push({ method: "POST", path: `/api/v1/purchase-orders/${orderId}/receipts`, status: 503, response: { title: "Resposta interrompida" } })
  await page.getByRole("button", { name: "Registrar entrada e conta a pagar", exact: true }).click()
  await expect(page.getByLabel("Referência do recebimento", { exact: true }).filter({ visible: true })).toBeDisabled()
  const received = { ...order!, data: { ...order!.data, status: "partially_received", revision: 3 }, items: [{ ...order!.items[0], receivedQuantity: "1.000000" }], receiptCount: 1 }
  plans.push({ method: "POST", path: `/api/v1/purchase-orders/${orderId}/receipts`, status: 201, response: { order: received, receipt: {}, payableId }, revision: 3, apply: () => { order = received } })
  await page.getByRole("button", { name: "Repetir confirmação da compra", exact: true }).click()
  await expect(page.getByText("Situação: Recebido parcialmente", { exact: true })).toBeVisible()
  expect(calls[0]).toEqual(calls[1])
  await expect(page.getByRole("button", { name: "Cancelar compra", exact: true })).toHaveCount(0)
  await page.getByLabel("Motivo do cancelamento ou encerramento", { exact: true }).filter({ visible: true }).fill("Saldo não será entregue")
  const closed = { ...received, data: { ...received.data, status: "closed", revision: 4 } }
  plans.push({ method: "POST", path: `/api/v1/purchase-orders/${orderId}/close`, status: 200, response: closed, revision: 4, apply: () => { order = closed } })
  await page.getByRole("button", { name: "Encerrar saldo pendente", exact: true }).click()
  await expect(page.getByText("Situação: Saldo encerrado", { exact: true })).toBeVisible()
  expect(calls[2]).toMatchObject({ revision: '"3"', body: { reason: "Saldo não será entregue" } })
  order = draft()
  await page.reload()
  await page.getByLabel("Motivo do cancelamento ou encerramento", { exact: true }).filter({ visible: true }).fill("Compra não necessária")
  const cancelled = { ...order!, data: { ...order!.data, status: "cancelled", revision: 2 } }
  plans.push({ method: "POST", path: `/api/v1/purchase-orders/${orderId}/cancel`, status: 200, response: cancelled, revision: 2, apply: () => { order = cancelled } })
  await page.getByRole("button", { name: "Cancelar compra", exact: true }).click()
  await expect(page.getByText("Situação: Cancelado", { exact: true })).toBeVisible()
})
