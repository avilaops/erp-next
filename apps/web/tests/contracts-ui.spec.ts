import { expect, test } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"

// Browser/BFF fixture only. The Rust test owns provider reconciliation and RLS.
const origin = "http://127.0.0.1:33118"
const tenant = "11111111-1111-4111-8111-111111111111"
const orderId = "22222222-2222-4222-8222-222222222222"
const customerId = "33333333-3333-4333-8333-333333333333"
const contractId = "44444444-4444-4444-8444-444444444444"
const fileId = "55555555-5555-4555-8555-555555555555"
const snapshot = { order: { id: orderId, revision: 1, amount: "100.00", dueDate: "2026-12-01" }, company: { legalName: "Empresa de validação", taxId: "04252011000110" }, customer: { id: customerId, name: "Cliente de validação", taxId: "52998224725", email: "validation@example.test" }, items: [] }
type Recipient = { name: string; role: string; email: string }
const commercialRoles = ["Compradora", "Vendedora", "Testemunha 1", "Testemunha 2"]
// Generic data only: the customer's Word, clauses, and banking details stay private.
const commercialDefaults = { cliente_nome: snapshot.customer.name, pedido_total: "100.00", itens: Array.from({ length: 10 }, (_, index) => `Acessório de teste ${index + 1} | 1 UN | R$ 10,00`).join("\n") }
const commercialManualFields = ["condicoes", "entrega", "Representante — nome", "Representante — CPF", "Testemunha 1 — nome", "Testemunha 1 — CPF", "Testemunha 2 — nome", "Testemunha 2 — CPF", ...Array.from({ length: 20 }, (_, index) => `Informação comercial ${index + 1}`)]
let commercial = false
let generationCalls = 0
let generatedRecipients: Recipient[] = []
let generatedFields: Record<string, string> = {}
let generationKeys: string[] = []
let status = "created"
let revision = 1
let canSend = true
let emailReady = false
let generated = false
let sends = 0
let reviewCalls = 0
const failures: string[] = []
const pdf = Buffer.from("%PDF-1.7\n% isolated browser fixture")
function detail() {
  return { tenantId: tenant, canEdit: true, canSend, emailReady, data: { id: contractId, orderId, customerId, templateName: commercial ? "Contrato comercial com quatro signatários" : "Contrato de validação", status, revision, snapshot, recipients: commercial ? generatedRecipients : [{ name: "Cliente de validação", role: "Cliente", email: "validation@example.test" }], fields: commercial ? generatedFields : { cliente_nome: "Cliente de validação", condicoes: "Validação autorizada" }, externalId: 7, problem: null, sendRequestedAt: sends ? "2026-10-29T00:00:00Z" : null, progress: [], reviewedAt: reviewCalls ? "2026-10-29T00:00:00Z" : null, completedAt: null }, files: [{ id: fileId, kind: "preview", position: 0, sha256: createHash("sha256").update(pdf).digest("hex") }] }
}
const upstream = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json")
  try {
    expect(request.headers.authorization).toBe("Bearer contracts-fixture-token")
    expect(request.headers["x-tenant-id"]).toBe(tenant)
    const url = new URL(request.url!, origin)
    if (url.pathname === "/api/v1/me") { response.end(JSON.stringify({ tenant: { id: tenant, legalName: "Empresa de validação" }, permissions: ["sales.orders.read", "sales.orders.manage", "sales.contracts.send"] })); return }
    if (url.pathname === `/api/v1/orders/${orderId}`) { response.end(JSON.stringify({ tenantId: tenant, canEdit: true, data: { id: orderId, customerId, customerName: snapshot.customer.name, amount: "100.00", dueDate: "2026-12-01", status: "draft", revision: 1 }, items: [] })); return }
    if (url.pathname === `/api/v1/commercial-contracts/options/${orderId}`) {
      if (commercial) {
        response.end(JSON.stringify({ tenantId: tenant, canEdit: true, configured: true, emailReady, snapshot, defaults: commercialDefaults, templates: [{ id: 3, name: "Contrato comercial com quatro signatários", updatedAt: "2026-10-29T00:00:00Z", roles: commercialRoles.map((name, index) => ({ name, uuid: `signer-${index}` })), fields: [...Object.keys(commercialDefaults), ...commercialManualFields].map(name => ({ name, type: "text", required: true })) }] })); return
      }
      response.end(JSON.stringify({ tenantId: tenant, canEdit: true, configured: true, emailReady, snapshot, defaults: { cliente_nome: snapshot.customer.name }, templates: [{ id: 1, name: "Contrato de validação", updatedAt: "2026-10-29T00:00:00Z", roles: [{ name: "Cliente", uuid: "customer" }], fields: [{ name: "cliente_nome", type: "text", required: true }, { name: "condicoes", type: "text", required: true }] }] })); return
    }
    if (request.method === "POST") {
      expect(request.headers["idempotency-key"]).toMatch(/^[a-f0-9-]{36}$/)
      let raw = ""; for await (const chunk of request) raw += chunk
      const body = JSON.parse(raw)
      if (url.pathname === "/api/v1/commercial-contracts") {
        expect(body.orderId).toBe(orderId)
        expect(body.recipients[0].email).toBe("validation@example.test")
        expect(body.fields.condicoes).toBe("Validação autorizada")
        generationCalls++
        generationKeys.push(String(request.headers["idempotency-key"]))
        generatedRecipients = body.recipients
        generatedFields = body.fields
        if (commercial) {
          expect(body.templateId).toBe(3)
          expect(body.orderRevision).toBe(1)
          expect(body.recipients.map((recipient: Recipient) => recipient.role)).toEqual(commercialRoles)
          expect(Object.keys(body.fields)).toHaveLength(31)
          // Keep the request in flight so a second click cannot dispatch another command.
          await new Promise(resolve => setTimeout(resolve, 200))
        }
        generated = true
      } else if (url.pathname.endsWith("/review")) {
        expect(request.headers["if-match"]).toBe('"1"')
        reviewCalls++; status = "reviewed"; revision++
      } else if (url.pathname.endsWith("/send")) {
        expect(status).toBe("reviewed")
        sends++; status = "send_requested"; revision++
      }
      response.setHeader("ETag", `"${revision}"`); response.end(JSON.stringify(detail())); return
    }
    if (url.pathname.endsWith(`/files/${fileId}`)) { response.setHeader("Content-Type", "application/pdf"); response.end(pdf); return }
    if (url.pathname === `/api/v1/commercial-contracts/${contractId}`) { response.setHeader("ETag", `"${revision}"`); response.end(JSON.stringify(detail())); return }
    if (url.pathname === "/api/v1/commercial-contracts") { response.end(JSON.stringify({ tenantId: tenant, canEdit: true, total: generated ? 1 : 0, data: generated ? [{ ...detail().data, customerName: snapshot.customer.name }] : [] })); return }
    response.statusCode = 404; response.end(JSON.stringify({ title: "Recurso não encontrado" }))
  } catch (error) { failures.push(String(error)); response.statusCode = 500; response.end(JSON.stringify({ title: "Falha no contrato da fixture" })) }
})
function cookie() {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update("danfe-browser-fixture-not-a-real-service-secret").digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "contracts-fixture-token", tenantId: tenant, expiresAt: Date.now() + 3600_000 })), cipher.final()])
  return { name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" as const }
}
test.beforeAll(async () => { await new Promise<void>(resolve => upstream.listen(33119, "127.0.0.1", resolve)) })
test.afterAll(async () => { await new Promise<void>(resolve => upstream.close(() => resolve())) })
test.beforeEach(() => {
  status = "created"; revision = 1; canSend = true; emailReady = false
  generated = false; sends = 0; reviewCalls = 0; commercial = false; generationCalls = 0
  generatedRecipients = []; generatedFields = {}; generationKeys = []; failures.length = 0
})

test("pedido gera prévia, exige revisão e permite acompanhar o mesmo contrato pelo cliente", async ({ page, context }) => {
  expect((await context.request.get("/api/erp/commercial-contracts")).status()).toBe(401)
  await context.addCookies([cookie()])
  await page.goto(`/vendas/pedidos/${orderId}`)
  await page.getByRole("link", { name: "Contratos do pedido", exact: true }).click()
  await page.getByRole("link", { name: "Gerar contrato", exact: true }).click()
  await expect(page.getByRole("button", { name: "Gerar prévia para revisão" })).toBeDisabled()
  await page.getByLabel("Condições comerciais").fill("Validação autorizada")
  await page.getByRole("button", { name: "Gerar prévia para revisão" }).click()
  await page.waitForURL(`**/servicos/contratos/${contractId}`)
  expect(sends).toBe(0)
  await expect(page.getByRole("button", { name: "Confirmar revisão" })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Enviar para assinatura", exact: true })).toHaveCount(0)
  await page.getByRole("checkbox").check()
  await page.getByRole("button", { name: "Confirmar revisão" }).click()
  await expect(page.getByRole("button", { name: "Enviar para assinatura", exact: true })).toBeDisabled()
  await expect(page.getByText("O e-mail de assinatura ainda não foi validado. A prévia e a revisão estão disponíveis; o envio está bloqueado.")).toBeVisible()
  expect(sends).toBe(0)
  emailReady = true
  await page.reload()
  await page.getByRole("button", { name: "Enviar para assinatura", exact: true }).click()
  await expect(page.getByText("Envio solicitado", { exact: true })).toBeVisible()
  expect(sends).toBe(1)
  await expect(page.getByRole("button", { name: "Enviar para assinatura", exact: true })).toHaveCount(0)
  await page.getByRole("link", { name: "Contratos do cliente", exact: true }).click()
  await page.getByRole("link", { name: "Contrato de validação", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/servicos/contratos/${contractId}$`))
  const wrongTenant = await context.request.post(`/api/erp/commercial-contracts/${contractId}/send`, { headers: { Origin: origin, "X-Tenant-Id": customerId }, data: {} })
  expect(wrongTenant.status()).toBe(409)
  canSend = false; status = "created"
  await page.reload()
  await expect(page.getByText("A revisão e o envio exigem permissão específica para contratos.")).toBeVisible()
  await expect(page.getByRole("checkbox")).toHaveCount(0)
  expect(failures).toEqual([])
})

test("contrato comercial confere 31 campos e quatro destinatários antes da revisão, sem enviar convite", async ({ page, context }, testInfo) => {
  commercial = true
  await context.addCookies([cookie()])
  await page.goto(`/vendas/pedidos/${orderId}/contratos/novo`)
  await expect(page.getByLabel("Modelo de contrato")).toHaveValue("3")
  await expect(page.locator("textarea")).toHaveCount(31)
  await expect(page.getByText(/^Faltam 28 campos obrigatórios:/)).toBeVisible()
  const generate = page.getByRole("button", { name: "Gerar prévia para revisão" })
  await expect(generate).toBeDisabled()
  const buyer = page.getByRole("textbox", { name: /^Nome do cliente/ })
  await expect(buyer).toHaveValue(snapshot.customer.name)
  await expect(buyer).toHaveJSProperty("readOnly", true)
  const items = page.getByRole("textbox", { name: /^Itens, quantidades e valores/ })
  await expect(items).toHaveValue(commercialDefaults.itens)
  await expect(items).toHaveJSProperty("readOnly", true)
  const manualValues = Object.fromEntries(commercialManualFields.map(name => [name, name === "condicoes" ? "Validação autorizada" : `Dado fictício: ${name}`]))
  for (const [name, value] of Object.entries(manualValues)) {
    const caption = name === "condicoes" ? "Condições comerciais" : name === "entrega" ? "Condições e prazo de entrega" : name
    await page.getByRole("textbox", { name: `${caption} *`, exact: true }).fill(value)
  }
  await expect(page.getByText(/^Faltam \d+ campos obrigatórios:/)).toHaveCount(0)
  // Required recipient inputs must stop a request even after all document fields are ready.
  await generate.click()
  expect(generationCalls).toBe(0)
  const recipients = commercialRoles.map((role, index) => ({ role, name: index ? `Pessoa de teste ${index}` : snapshot.customer.name, email: index ? `signer${index}@example.test` : snapshot.customer.email }))
  for (const recipient of recipients) {
    const group = page.getByRole("heading", { name: recipient.role, exact: true }).locator("..")
    await group.getByLabel("Nome", { exact: true }).fill(recipient.name)
    await group.getByLabel("E-mail", { exact: true }).fill(recipient.email)
  }
  const lastSigner = page.getByRole("heading", { name: "Testemunha 2", exact: true }).locator("..")
  await lastSigner.getByLabel("E-mail", { exact: true }).fill("email-invalido")
  await generate.click()
  expect(generationCalls).toBe(0)
  await lastSigner.getByLabel("E-mail", { exact: true }).fill(recipients[3].email)
  await generate.evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await page.waitForURL(`**/servicos/contratos/${contractId}`)
  expect(generationCalls).toBe(1)
  expect(new Set(generationKeys).size).toBe(1)
  expect(generatedRecipients).toEqual(recipients)
  expect(generatedFields).toEqual({ ...commercialDefaults, ...manualValues })
  for (const recipient of recipients) await expect(page.getByText(`${recipient.role} · ${recipient.email}`, { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Confirmar revisão" })).toBeDisabled()
  const storedFile = await context.request.get(`/api/erp/commercial-contracts/${contractId}/files/${fileId}`)
  expect(storedFile.status()).toBe(200)
  expect(storedFile.headers()["content-type"]).toContain("application/pdf")
  expect(await storedFile.body()).toEqual(pdf)
  await page.getByRole("checkbox").check()
  await page.getByRole("button", { name: "Confirmar revisão" }).click()
  await expect(page.getByRole("button", { name: "Enviar para assinatura", exact: true })).toBeDisabled()
  await expect(page.getByText("Revisado", { exact: true })).toBeVisible()
  expect(reviewCalls).toBe(1)
  expect(sends).toBe(0)
  await page.getByRole("link", { name: "Contratos do cliente", exact: true }).click()
  await page.getByRole("link", { name: "Contrato comercial com quatro signatários", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/servicos/contratos/${contractId}$`))
  await expect(page.getByRole("button", { name: "Enviar para assinatura", exact: true })).toBeDisabled()
  await page.getByText("Conferir campos utilizados", { exact: true }).click()
  await expect(page.getByRole("definition").filter({ hasText: manualValues["Testemunha 2 — CPF"] })).toBeVisible()
  await testInfo.attach("four-signers-reviewed", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" })
  expect(generationCalls).toBe(1)
  expect(reviewCalls).toBe(1)
  expect(sends).toBe(0)
  expect(failures).toEqual([])
})
