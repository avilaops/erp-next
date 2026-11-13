import { expect as baseExpect, test } from "@playwright/test"
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto"
import { createServer } from "node:http"

const origin = "http://127.0.0.1:33118"
const expect = baseExpect.configure({ timeout: 30_000 })
const tenant = "11111111-1111-4111-8111-111111111111"
const order = "22222222-2222-4222-8222-222222222222"
const titleIds = ["33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"]
const contract = "55555555-5555-4555-8555-555555555555"
const methodId = "66666666-6666-4666-8666-666666666666"
// Above the old 64 KiB BFF ceiling, still tiny compared with the 10 MiB limit.
const proof = Buffer.concat([Buffer.from("%PDF-1.4\nsynthetic supporting evidence\n"), Buffer.alloc(80_000, 32), Buffer.from("\n%%EOF")])
type Payment = { id: string; kind: string; amount: string; reference: string; occurredOn: string; method: string; reversesId: null }
let payments: Payment[][] = [[], []]
let documents: Record<string, unknown>[] = []
let readonly = false
let salesOnly = false
let calls = 0
let loseReceiptResponse = false
let loseDocumentResponse = false
let orderEditable = false
let contractRevision = 1
let syncCalls = 0
let orderReads = 0
let failOrderReload = false
let orderStatus = "confirmed"
let orderRevision = 1
let orderCheckout = false
let loseAcceptanceResponse = false
let acceptanceKey: string | null = null
const acceptanceCommands: { key: string; etag: string }[] = []
const documentCommands: { key: string; body: string }[] = []
const documentsByKey = new Map<string, ReturnType<typeof addDocument>>()
const receiptsByKey = new Map<string, ReturnType<typeof title>>()
const failures: string[] = []
function orderSnapshot() {
  const method = { id: methodId, name: "Pix configurado", modality: "pix" }
  return { tenantId: tenant, canEdit: orderEditable, data: { id: order, customerName: "Cliente sintético", amount: "100000.00", dueDate: "2026-12-01", status: orderStatus, revision: orderRevision }, items: [],
    checkout: orderCheckout ? { confirmationCreatesReceivables: orderStatus === "draft", customer: { legalName: "Cliente sintético", addresses: [], contacts: [] }, entry: { amountCents: 5000000, paymentMethodId: methodId, paymentMethod: method, dueOn: "2026-11-13" }, installments: [{ id: titleIds[1], number: 1, paymentMethodId: methodId, paymentMethod: method, amountCents: 5000000, dueOn: "2026-12-01" }], manufacturingDays: 30 } : null }
}
function title(index: number) {
  const received = payments[index].reduce((sum, p) => sum + Number(p.amount), 0)
  return { tenantId: tenant, canEdit: !readonly, data: { id: titleIds[index], orderId: order, customerName: "Cliente sintético", amount: "50000.00", receivedAmount: received.toFixed(2), outstandingAmount: (50000 - received).toFixed(2), status: received === 50000 ? "paid" : "open", revision: payments[index].length + 1, dueDate: "2026-12-01", installmentKind: index ? "balance" : "entry", installmentNumber: index }, payments: payments[index] }
}
function addDocument(input: Record<string, unknown>, paymentId: string | null) {
  expect(Buffer.from(input.contentBase64 as string, "base64")).toEqual(proof)
  const doc = { id: randomUUID(), orderId: order, paymentId, filename: input.filename, mediaType: input.mediaType, byteSize: proof.length, sha256: createHash("sha256").update(proof).digest("hex"), description: input.description, documentDate: input.documentDate, uploadedAt: "2026-11-13T12:00:00Z", uploadedBy: "Operador" }
  documents.push(doc); return doc
}
const upstream = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json")
  const reply = (value: unknown, status = 200) => { res.statusCode = status; res.end(JSON.stringify(value)) }
  try {
    expect(req.headers.authorization).toBe("Bearer receipts-fixture-token")
    expect(req.headers["x-tenant-id"]).toBe(tenant)
    const path = new URL(req.url!, origin).pathname
    if (path === "/api/v1/me") return reply({ tenant: { id: tenant, legalName: "Empresa sintética" }, permissions: ["sales.orders.read", ...(orderEditable ? ["sales.orders.manage"] : []), ...(salesOnly ? [] : ["finance.receivables.read", "finance.receivables.manage"])] })
    if (path === `/api/v1/orders/${order}`) { orderReads++; if (failOrderReload) return reply({ title: "Pedido temporariamente indisponível" }, 503); res.setHeader("ETag", `"${orderRevision}"`); return reply(orderSnapshot()) }
    if (path === `/api/v1/orders/${order}/accept` && req.method === "POST") {
      const key = String(req.headers["idempotency-key"]), etag = String(req.headers["if-match"])
      acceptanceCommands.push({ key, etag })
      expect(etag).toBe('"1"')
      expect(key).toMatch(/^[a-f0-9-]{36}$/)
      if (acceptanceKey && acceptanceKey !== key) return reply({ title: "Pedido já aceito" }, 409)
      acceptanceKey = key; orderStatus = "accepted"; orderRevision = 2
      if (loseAcceptanceResponse) { loseAcceptanceResponse = false; return reply({ title: "Resposta do aceite interrompida" }, 503) }
      res.setHeader("ETag", '"2"'); return reply(orderSnapshot())
    }
    if (path === `/api/v1/orders/${order}/finance`) {
      if (salesOnly) return reply({ title: "Sem permissão financeira" }, 403)
      const received = payments.flat().reduce((sum, p) => sum + Number(p.amount), 0)
      return reply({ tenantId: tenant, orderId: order, orderStatus, orderAmount: "100000.00", titleAmount: "100000.00", receivedAmount: received.toFixed(2), outstandingAmount: (100000 - received).toFixed(2), state: received === 100000 ? "paid" : received ? "partial" : "open", canEdit: !readonly, receivables: titleIds.map((_, i) => title(i)) })
    }
    if (path === "/api/v1/payment-methods") return reply({ data: [{ id: methodId, code: "PIX", name: "Pix configurado", modality: "pix", status: "active" }] })
    if (path === "/api/v1/financial-accounts") return reply({ data: [] })
    const match = path.match(/\/receivables\/([^/]+)(\/payments)?$/)
    if (match) {
      const index = titleIds.indexOf(match[1])
      if (index < 0) return reply({}, 404)
      if (match[2]) {
        const key = String(req.headers["idempotency-key"])
        const previous = receiptsByKey.get(key)
        if (previous) { res.setHeader("ETag", `"${previous.data.revision}"`); return reply(previous) }
        expect(req.headers["if-match"]).toBe(`"${title(index).data.revision}"`)
        expect(req.headers["idempotency-key"]).toBeTruthy()
        let body = ""; for await (const part of req) body += part
        const input = JSON.parse(body)
        expect(input.paymentMethodId).toBe(methodId)
        const payment = { id: randomUUID(), kind: "receipt", amount: input.amount, reference: input.reference, occurredOn: input.occurredOn, method: "bank_transfer", reversesId: null }
        payments[index].push(payment); calls++
        if (input.supportingDocument) addDocument(input.supportingDocument, payment.id)
        receiptsByKey.set(key, title(index))
        if (loseReceiptResponse) { loseReceiptResponse = false; return reply({ title: "Réponse interrompue" }, 503) }
      }
      res.setHeader("ETag", `"${title(index).data.revision}"`); return reply(title(index))
    }
    if (path === `/api/v1/orders/${order}/documents`) {
      if (req.method === "POST") {
        expect(req.headers["idempotency-key"]).toBeTruthy()
        let body = ""; for await (const part of req) body += part
        const key = String(req.headers["idempotency-key"])
        documentCommands.push({ key, body })
        const previous = documentsByKey.get(key)
        if (previous) { res.setHeader("ETag", `"${previous.sha256}"`); return reply({ tenantId: tenant, orderId: order, data: previous }, 201) }
        const input = JSON.parse(body); const doc = addDocument(input.document, input.paymentId || null)
        documentsByKey.set(key, doc)
        if (loseDocumentResponse) { loseDocumentResponse = false; return reply({ title: "Confirmação de documento interrompida" }, 503) }
        res.setHeader("ETag", `"${doc.sha256}"`); return reply({ tenantId: tenant, orderId: order, data: doc }, 201)
      }
      return reply({ tenantId: tenant, orderId: order, canAttachOther: !readonly, canAttachPayment: !readonly && !salesOnly, data: salesOnly ? documents.filter(d => !d.paymentId) : documents })
    }
    if (path.startsWith(`/api/v1/orders/${order}/documents/`)) { res.setHeader("Content-Type", "application/pdf"); res.setHeader("Content-Disposition", 'attachment; filename="comprovante.pdf"'); res.end(proof); return }
    if (path === `/api/v1/commercial-contracts/${contract}` || path === `/api/v1/commercial-contracts/${contract}/sync`) {
      if (req.method === "POST") { syncCalls++; contractRevision++ }
      res.setHeader("ETag", `"${contractRevision}"`)
      return reply({ tenantId: tenant, canEdit: false, canSend: false, emailReady: true, files: [], data: { id: contract, orderId: order, customerId: titleIds[0], templateName: "Contrato assinado", status: "completed", revision: contractRevision, snapshot: { company: { legalName: "Empresa sintética" }, customer: { name: "Cliente sintético", taxId: "52998224725" }, order: { amount: "100000.00", revision: 1 } }, recipients: [], progress: [], fields: {} } })
    }
    return reply({ title: "Não disponível na fixture" }, 404)
  } catch (error) { failures.push(String(error)); reply({ title: "Falha na fixture" }, 500) }
})
function cookie() {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", createHash("sha256").update("danfe-browser-fixture-not-a-real-service-secret").digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "receipts-fixture-token", tenantId: tenant, expiresAt: Date.now() + 3600_000 })), cipher.final()])
  return { name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" as const }
}
test.beforeAll(async () => { await new Promise<void>(resolve => upstream.listen(33119, "127.0.0.1", resolve)) })
test.afterAll(async () => { await new Promise<void>(resolve => upstream.close(() => resolve())) })
test.beforeEach(async ({ context }) => { payments = [[], []]; documents = []; readonly = false; salesOnly = false; calls = 0; loseReceiptResponse = false; loseDocumentResponse = false; orderEditable = false; contractRevision = 1; syncCalls = 0; orderReads = 0; failOrderReload = false; orderStatus = "confirmed"; orderRevision = 1; orderCheckout = false; loseAcceptanceResponse = false; acceptanceKey = null; acceptanceCommands.length = 0; documentCommands.length = 0; documentsByKey.clear(); receiptsByKey.clear(); failures.length = 0; await context.addCookies([cookie()]) })
test.afterEach(() => expect(failures).toEqual([]))

test("encomenda: BFF permite somente POST autenticado com origem, revisão e chave", async ({ context }) => {
  orderStatus = "draft"; orderEditable = true; orderCheckout = true
  const url = `${origin}/api/erp/orders/${order}/accept`
  const headers = { Origin: origin, "X-Tenant-Id": tenant, "If-Match": '"1"', "Idempotency-Key": randomUUID() }
  const response = await context.request.post(url, { headers, data: {} })
  expect(response.status()).toBe(200)
  expect((await response.json()).data.status).toBe("accepted")
  expect(response.headers().etag).toBe('"2"')
  expect((await context.request.get(url, { headers })).status()).toBe(405)
  expect((await context.request.post(url, { headers: { ...headers, Origin: "https://foreign.invalid" }, data: {} })).status()).toBe(403)
  expect(acceptanceCommands).toHaveLength(1)
})

test("encomenda: resposta perdida repete a mesma intenção e conserva a revisão do aceite", async ({ page }) => {
  orderStatus = "draft"; orderEditable = true; orderCheckout = true; salesOnly = true; loseAcceptanceResponse = true
  await page.goto(`/vendas/pedidos/${order}`)
  await page.getByRole("button", { name: "Aceitar encomenda e gerar parcelas", exact: true }).click()
  const repeat = page.getByRole("button", { name: "Repetir aceite da encomenda", exact: true })
  await expect(repeat).toBeVisible()
  expect(acceptanceCommands).toHaveLength(1)
  await repeat.click()
  await expect(page.getByText("Encomenda aceita", { exact: true })).toBeVisible()
  expect(acceptanceCommands).toHaveLength(2)
  expect(acceptanceCommands[1]).toEqual(acceptanceCommands[0])
  await expect(page.getByRole("button", { name: "Reservar estoque disponível", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Registrar recebimento", exact: true })).toHaveCount(0)
})

for (const width of [375, 768, 1440]) test(`encomenda: ações aceitas, financeiro e responsividade em ${width}px`, async ({ page }) => {
  orderStatus = "accepted"; orderRevision = 2; orderEditable = true; orderCheckout = true
  await page.setViewportSize({ width, height: 900 })
  await page.goto(`/vendas/pedidos/${order}`)
  await expect(page.getByText("Encomenda aceita", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Reservar estoque disponível", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Cancelar pedido", exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Editar rascunho", exact: true })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Preparar NF-e deste pedido", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /Concluir pedido/ })).toHaveCount(0)
  await expect(page.getByRole("region", { name: "Financeiro do pedido", exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
})

test("pedido soma recebimentos de todas as parcelas e permite mais provas sem novo dinheiro", async ({ page }) => {
  await page.goto(`/vendas/pedidos/${order}`)
  const panel = page.getByRole("region", { name: "Financeiro do pedido", exact: true })
  await expect(panel.getByTestId("order-outstanding")).toContainText("100.000,00")
  for (const [index, amount, balance] of [[0, "50000", "50.000,00"], [1, "10000", "40.000,00"], [1, "40000", "0,00"]] as const) {
    await panel.getByLabel("Parcela para recebimento").selectOption(titleIds[index])
    await panel.getByLabel("Valor recebido").fill(amount)
    await panel.getByLabel("Data do recebimento", { exact: true }).fill("2026-11-13")
    await panel.getByRole("combobox", { name: "Forma de pagamento", exact: true }).selectOption(methodId)
    await panel.getByLabel("Referência do recebimento").fill(`Recebimento ${amount}`)
    await panel.getByLabel("Arquivo do comprovante").setInputFiles({ name: "comprovante.pdf", mimeType: "application/pdf", buffer: proof })
    await panel.getByRole("button", { name: "Confirmar recebimento declarado", exact: true }).click()
    await expect(panel.getByTestId("order-outstanding")).toHaveText(`R$ ${balance}`)
  }
  expect(calls).toBe(3)
  const docs = page.getByRole("region", { name: "Outros documentos", exact: true })
  await docs.getByLabel("Vincular documento").selectOption(payments[1][0].id)
  await docs.getByLabel("Arquivo do documento").setInputFiles({ name: "segunda-prova.pdf", mimeType: "application/pdf", buffer: proof })
  await docs.getByLabel("Descrição do documento").fill("Segunda prova do mesmo recebimento")
  await docs.getByRole("button", { name: "Adicionar documento", exact: true }).click()
  await expect(docs.getByText("segunda-prova.pdf", { exact: true })).toBeVisible()
  expect(calls).toBe(3); expect(documents).toHaveLength(4)
  await expect(panel.getByTestId("order-received")).toContainText("100.000,00")
})

for (const width of [375, 768, 1440]) test(`documento posterior à assinatura preserva contrato e cabe em ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 })
  await page.goto(`/servicos/contratos/${contract}`)
  const docs = page.getByRole("region", { name: "Outros documentos", exact: true })
  await docs.getByLabel("Arquivo do documento").setInputFiles({ name: "adicional.pdf", mimeType: "application/pdf", buffer: proof })
  await docs.getByLabel("Descrição do documento").fill("Documento após assinatura")
  await docs.getByRole("button", { name: "Adicionar documento", exact: true }).click()
  await expect(docs.getByText("adicional.pdf", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Contrato assinado", exact: true })).toBeVisible()
  expect(calls).toBe(0)
  await info.attach(`outros-documentos-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
})

test("somente consulta não oferece comandos e vendas não exibe dados financeiros", async ({ page }) => {
  readonly = true
  await page.goto(`/vendas/pedidos/${order}`)
  await expect(page.getByTestId("order-outstanding")).toContainText("100.000,00")
  await expect(page.getByRole("button", { name: "Confirmar recebimento declarado" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Adicionar documento", exact: true })).toHaveCount(0)
  salesOnly = true
  await page.reload()
  await expect(page.getByText("Sem acesso ao financeiro deste pedido.", { exact: true })).toBeVisible()
  await expect(page.getByTestId("order-outstanding")).toHaveCount(0)
})

test("resposta incerta preserva título e chave para repetir sem duplicar recebimento", async ({ page }) => {
  loseReceiptResponse = true
  await page.goto(`/vendas/pedidos/${order}`)
  await page.getByLabel("Valor recebido").fill("10000")
  await page.getByLabel("Data do recebimento", { exact: true }).fill("2026-11-13")
  await page.getByRole("combobox", { name: "Forma de pagamento", exact: true }).selectOption(methodId)
  await page.getByLabel("Referência do recebimento").fill("Resposta incerta")
  await page.getByRole("button", { name: "Confirmar recebimento declarado", exact: true }).click()
  await expect(page.getByRole("button", { name: "Repetir confirmação financeira" })).toBeVisible()
  await expect(page.getByLabel("Parcela para recebimento")).toBeDisabled()
  await page.getByRole("button", { name: "Repetir confirmação financeira" }).click()
  await expect(page.getByTestId("order-outstanding")).toContainText("90.000,00")
  expect(calls).toBe(1)
})

test("BFF preserva bytes privados e rejeita origem, empresa e corpo acima do limite", async ({ context }) => {
  const endpoint = `${origin}/api/erp/orders/${order}/documents`
  const headers = { Origin: origin, "X-Tenant-Id": tenant, "Idempotency-Key": randomUUID() }
  const data = { document: { filename: "proof.pdf", mediaType: "application/pdf", contentBase64: proof.toString("base64"), description: "Evidência sintética" } }
  expect((await context.request.post(endpoint, { headers: { ...headers, Origin: "https://other.example" }, data })).status()).toBe(403)
  expect((await context.request.post(endpoint, { headers: { ...headers, "X-Tenant-Id": titleIds[0] }, data })).status()).toBe(409)
  expect((await context.request.post(endpoint, { headers, data: { document: { ...data.document, contentBase64: "A".repeat(14_100_001) } } })).status()).toBe(413)
  expect(documents).toHaveLength(0)
  const saved = await context.request.post(endpoint, { headers, data })
  expect(saved.status()).toBe(201)
  const downloaded = await context.request.get(`${endpoint}/${(await saved.json()).data.id}`)
  expect(downloaded.headers()["cache-control"]).toContain("no-store")
  expect(downloaded.headers()["content-disposition"]).toContain("attachment")
  expect(downloaded.headers()["x-content-type-options"]).toBe("nosniff")
  expect(await downloaded.body()).toEqual(proof)
  expect((await context.request.get(`${endpoint}?paymentId=${titleIds[0]}`)).status()).toBe(400)
})

test("conta a receber mostra só comprovantes dos seus próprios recebimentos", async ({ page }) => {
  payments = titleIds.map((_, i) => [{ id: randomUUID(), kind: "receipt", amount: "10000.00", method: "bank_transfer", reference: `Parcela ${i}`, occurredOn: "2026-11-13", reversesId: null }])
  for (let i = 0; i < 2; i++) addDocument({ filename: `parcela-${i}.pdf`, mediaType: "application/pdf", contentBase64: proof.toString("base64"), description: `Prova ${i}` }, payments[i][0].id)
  await page.goto(`/financeiro/contas-receber/${titleIds[0]}`)
  const docs = page.getByRole("region", { name: "Outros documentos", exact: true })
  await expect(docs.getByText("parcela-0.pdf", { exact: true })).toBeVisible()
  await expect(docs.getByText("parcela-1.pdf", { exact: true })).toHaveCount(0)
  await expect(docs.getByLabel("Vincular documento")).toHaveValue(payments[0][0].id)
})

for (const screen of ["contrato", "pedido", "recebível"] as const) test(`comprovante incerto conserva chave e corpo ao acionar ${screen}`, async ({ page }) => {
  loseDocumentResponse = true; orderEditable = true
  payments[0] = [{ id: randomUUID(), kind: "receipt", amount: "10000.00", method: "bank_transfer", reference: "Recebimento já registrado", occurredOn: "2026-11-13", reversesId: null }]
  await page.goto(screen === "contrato" ? `/servicos/contratos/${contract}` : screen === "pedido" ? `/vendas/pedidos/${order}` : `/financeiro/contas-receber/${titleIds[0]}`)
  const action = screen === "contrato" ? page.getByRole("button", { name: "Atualizar andamento", exact: true }) : screen === "pedido" ? page.getByRole("button", { name: "Concluir e gerar conta a receber", exact: true }) : page.getByRole("button", { name: "Confirmar recebimento declarado", exact: true })
  await expect(action).toBeEnabled()
  if (screen === "pedido") { await page.getByRole("button", { name: "Salvar PDF", exact: true }).click(); await expect(page.getByRole("button", { name: "Atualizar dados do pedido", exact: true })).toBeVisible() }
  const docs = page.getByRole("region", { name: "Outros documentos", exact: true })
  await docs.getByLabel("Vincular documento").selectOption(payments[0][0].id)
  await docs.getByLabel("Arquivo do documento").setInputFiles({ name: "prova-incerta.pdf", mimeType: "application/pdf", buffer: proof })
  await docs.getByLabel("Descrição do documento").fill("Prova com confirmação interrompida")
  await docs.getByRole("button", { name: "Adicionar documento", exact: true }).click()
  await expect(docs.getByRole("button", { name: "Repetir inclusão do documento", exact: true })).toBeVisible()
  await expect(docs.getByRole("button", { name: "Repetir inclusão do documento", exact: true })).toBeEnabled()
  await expect(action).toBeDisabled()
  await action.evaluate((button: HTMLButtonElement) => button.click())
  await expect(page.getByRole("button", { name: "Atualizar financeiro", exact: true })).toBeDisabled()
  if (screen === "recebível") await expect(page.getByRole("button", { name: `Estornar recebimento ${payments[0][0].id}`, exact: true })).toBeDisabled()
  expect(syncCalls).toBe(0); expect(calls).toBe(0)
  if (screen === "pedido") {
    const readsBefore = orderReads
    await page.getByRole("button", { name: "Atualizar dados do pedido", exact: true }).click()
    await expect(docs.getByRole("button", { name: "Repetir inclusão do documento", exact: true })).toBeEnabled()
    expect(orderReads).toBe(readsBefore)
  }
  await docs.getByRole("button", { name: "Repetir inclusão do documento", exact: true }).click()
  await expect(docs.getByText("prova-incerta.pdf", { exact: true })).toBeVisible()
  expect(documentCommands).toHaveLength(2)
  expect(documentCommands[1]).toEqual(documentCommands[0])
  expect(documents).toHaveLength(1)
  await expect(action).toBeEnabled()
  if (screen === "contrato") { await action.click(); await expect.poll(() => syncCalls).toBe(1); await expect(docs.getByText("prova-incerta.pdf", { exact: true })).toBeVisible() }
  if (screen === "pedido") await expect.poll(() => orderReads).toBe(2)
  expect(payments.flat()).toHaveLength(1)
})


test("falha da atualização adiada só desmonta após confirmar a mesma prova", async ({ page }) => {
  loseDocumentResponse = true
  await page.goto(`/vendas/pedidos/${order}`)
  await page.getByRole("button", { name: "Salvar PDF", exact: true }).click()
  const reload = page.getByRole("button", { name: "Atualizar dados do pedido", exact: true })
  await expect(reload).toBeVisible()
  const docs = page.getByRole("region", { name: "Outros documentos", exact: true })
  await docs.getByLabel("Arquivo do documento").setInputFiles({ name: "prova-antes-da-falha.pdf", mimeType: "application/pdf", buffer: proof })
  await docs.getByLabel("Descrição do documento").fill("Preservar chave até confirmação")
  await docs.getByRole("button", { name: "Adicionar documento", exact: true }).click()
  const retry = docs.getByRole("button", { name: "Repetir inclusão do documento", exact: true })
  await expect(retry).toBeEnabled()
  failOrderReload = true
  await reload.click()
  expect(orderReads).toBe(1)
  await expect(retry).toBeEnabled()
  await retry.click()
  await expect(page.getByText("Pedido temporariamente indisponível", { exact: true })).toBeVisible()
  expect(orderReads).toBe(2)
  expect(documentCommands).toHaveLength(2)
  expect(documentCommands[1]).toEqual(documentCommands[0])
  expect(documents).toHaveLength(1)
  expect(calls).toBe(0)
})
