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
let status = "created"
let revision = 1
let canSend = true
let generated = false
let sends = 0
let reviewCalls = 0
const failures: string[] = []
const pdf = Buffer.from("%PDF-1.7\n% isolated browser fixture")
function detail() {
  return { tenantId: tenant, canEdit: true, canSend, data: { id: contractId, orderId, customerId, templateName: "Contrato de validação", status, revision, snapshot, recipients: [{ name: "Cliente de validação", role: "Cliente", email: "validation@example.test" }], fields: { cliente_nome: "Cliente de validação", condicoes: "Validação autorizada" }, externalId: 7, problem: null, sendRequestedAt: sends ? "2026-10-29T00:00:00Z" : null, progress: [], reviewedAt: reviewCalls ? "2026-10-29T00:00:00Z" : null, completedAt: null }, files: [{ id: fileId, kind: "preview", position: 0, sha256: createHash("sha256").update(pdf).digest("hex") }] }
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
      response.end(JSON.stringify({ tenantId: tenant, canEdit: true, configured: true, snapshot, defaults: { cliente_nome: snapshot.customer.name }, templates: [{ id: 1, name: "Contrato de validação", updatedAt: "2026-10-29T00:00:00Z", roles: [{ name: "Cliente", uuid: "customer" }], fields: [{ name: "cliente_nome", type: "text", required: true }, { name: "condicoes", type: "text", required: true }] }] })); return
    }
    if (request.method === "POST") {
      expect(request.headers["idempotency-key"]).toMatch(/^[a-f0-9-]{36}$/)
      let raw = ""; for await (const chunk of request) raw += chunk
      const body = JSON.parse(raw)
      if (url.pathname === "/api/v1/commercial-contracts") {
        expect(body.orderId).toBe(orderId)
        expect(body.recipients[0].email).toBe("validation@example.test")
        expect(body.fields.condicoes).toBe("Validação autorizada")
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

test("pedido gera prévia, exige revisão e permite acompanhar o mesmo contrato pelo cliente", async ({ page, context }) => {
  expect((await context.request.get("/api/erp/contracts")).status()).toBe(401)
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
  await page.getByRole("button", { name: "Enviar para assinatura", exact: true }).click()
  await expect(page.getByText("Envio solicitado", { exact: true })).toBeVisible()
  expect(sends).toBe(1)
  await expect(page.getByRole("button", { name: "Enviar para assinatura", exact: true })).toHaveCount(0)
  await page.getByRole("link", { name: "Contratos do cliente", exact: true }).click()
  await page.getByRole("link", { name: "Contrato de validação", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/servicos/contratos/${contractId}$`))
  const wrongTenant = await context.request.post(`/api/erp/contracts/${contractId}/send`, { headers: { Origin: origin, "X-Tenant-Id": customerId }, data: {} })
  expect(wrongTenant.status()).toBe(409)
  canSend = false; status = "created"
  await page.reload()
  await expect(page.getByText("A revisão e o envio exigem permissão específica para contratos.")).toBeVisible()
  await expect(page.getByRole("checkbox")).toHaveCount(0)
  expect(failures).toEqual([])
})
