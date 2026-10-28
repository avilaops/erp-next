import { expect, test, type BrowserContext } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"

const origin = "http://127.0.0.1:33118"
const secret = "danfe-browser-fixture-not-a-real-service-secret"
const tenant = "11111111-1111-4111-8111-111111111111"
const foreignTenant = "22222222-2222-4222-8222-222222222222"
const existingId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const createdId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const rawKey = `erp_${tenant}_${"a".repeat(64)}`
type Summary = { id: string; name: string; keyPrefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }
type Call = { method: string; url: string; authorization?: string; tenant?: string | string[]; body: string }
let keys: Summary[] = []
let calls: Call[] = []
let unavailable = false

const upstream = createServer(async (request, response) => {
  let body = ""
  for await (const chunk of request) body += chunk
  calls.push({ method: request.method || "", url: request.url || "", authorization: request.headers.authorization, tenant: request.headers["x-tenant-id"], body })
  if (request.headers.authorization === "Bearer fixture-forbidden-token") {
    response.writeHead(403, { "Content-Type": "application/problem+json" })
    response.end(JSON.stringify({ title: "Sem permissão para gerenciar integrações", status: 403 })); return
  }
  if (unavailable) {
    response.writeHead(503, { "Content-Type": "application/problem+json" })
    response.end(JSON.stringify({ title: "Serviço temporariamente indisponível", status: 503 })); return
  }
  if (request.url === "/api/v1/integrations/service-keys" && request.method === "GET") {
    response.writeHead(200, { "Content-Type": "application/json" })
    response.end(JSON.stringify({ data: keys })); return
  }
  if (request.url === "/api/v1/integrations/service-keys" && request.method === "POST") {
    const input = JSON.parse(body) as { name: string }
    const created = { id: createdId, name: input.name, keyPrefix: `erp_${tenant}_aaaaaaaa`, key: rawKey, createdAt: "2026-10-28T12:00:00Z" }
    keys.unshift({ ...created, lastUsedAt: null, revokedAt: null })
    response.writeHead(201, { "Content-Type": "application/json", "Cache-Control": "no-store" })
    response.end(JSON.stringify(created)); return
  }
  if (request.url === `/api/v1/integrations/service-keys/${existingId}` && request.method === "DELETE") {
    keys = keys.map((key) => key.id === existingId ? { ...key, revokedAt: "2026-10-28T12:30:00Z" } : key)
    response.writeHead(204, { "Cache-Control": "no-store" }); response.end(); return
  }
  response.writeHead(404, { "Content-Type": "application/problem+json" })
  response.end(JSON.stringify({ title: "Recurso não encontrado", status: 404 }))
})

function cookie(token = "fixture-editor-token", expiresAt = Date.now() + 3600_000) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: token, tenantId: tenant, expiresAt })), cipher.final()])
  return { name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" as const }
}

async function authenticate(context: BrowserContext, token = "fixture-editor-token") {
  await context.addCookies([cookie(token)])
}

test.beforeAll(async () => {
  await new Promise<void>((resolve, reject) => { upstream.once("error", reject); upstream.listen(33119, "127.0.0.1", resolve) })
})
test.afterAll(async () => { if (upstream.listening) await new Promise<void>((resolve) => upstream.close(() => resolve())) })
test.beforeEach(() => {
  keys = [{ id: existingId, name: "Lojas produção", keyPrefix: `erp_${tenant}_12345678`, createdAt: "2026-10-28T10:00:00Z", lastUsedAt: "2026-10-28T11:00:00Z", revokedAt: null }]
  calls = []
  unavailable = false
})

test("BFF rejects anonymous, foreign-origin, changed-company and malformed revoke requests before upstream", async ({ context }) => {
  expect((await context.request.get("/api/erp/integrations/service-keys")).status()).toBe(401)
  await authenticate(context)
  const payload = { name: "Nova integração" }
  expect((await context.request.post("/api/erp/integrations/service-keys", { headers: { Origin: "https://foreign.example", "X-Tenant-Id": tenant }, data: payload })).status()).toBe(403)
  expect((await context.request.post("/api/erp/integrations/service-keys", { headers: { Origin: origin, "X-Tenant-Id": foreignTenant }, data: payload })).status()).toBe(409)
  expect((await context.request.delete("/api/erp/integrations/service-keys/not-a-uuid", { headers: { Origin: origin, "X-Tenant-Id": tenant } })).status()).toBe(404)
  expect(calls).toHaveLength(0)
  expect((await context.request.get("/api/erp/integrations/service-keys")).status()).toBe(200)
  expect(calls).toEqual([{ method: "GET", url: "/api/v1/integrations/service-keys", authorization: "Bearer fixture-editor-token", tenant, body: "" }])
})

test("administrator creates, sees once, dismisses and revokes a tenant service key", async ({ page, context }) => {
  await authenticate(context)
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })
  await page.goto("/preferencias/integracoes/lojas")
  await expect(page.getByRole("heading", { name: "Integração com Lojas" })).toBeVisible()
  await expect(page.getByText("Lojas produção", { exact: true })).toBeVisible()
  await page.getByLabel("Nome da chave").fill("Lojas homologação")
  await page.getByRole("button", { name: "Criar chave", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Chave criada. Copie agora" })).toBeVisible()
  await expect(page.getByLabel("Chave de serviço criada")).toHaveValue(rawKey)
  await expect(page.getByRole("button", { name: "Copiar chave" })).toBeVisible()
  expect(await page.evaluate(() => ({ local: Object.values(localStorage), session: Object.values(sessionStorage) }))).toEqual({ local: [], session: [] })
  await page.getByRole("button", { name: "Já salvei a chave" }).click()
  await expect(page.getByLabel("Chave de serviço criada")).toHaveCount(0)
  await page.reload()
  await expect(page.getByText("Lojas homologação", { exact: true })).toBeVisible()
  expect(await page.content()).not.toContain(rawKey)
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: "Revogar chave Lojas produção" }).click()
  await expect(page.getByText("Revogada", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Revogar chave Lojas produção" })).toHaveCount(0)
  expect(calls.some((call) => call.method === "POST" && call.authorization === "Bearer fixture-editor-token" && call.tenant === tenant && JSON.parse(call.body).name === "Lojas homologação")).toBe(true)
  expect(calls.some((call) => call.method === "DELETE" && call.url === `/api/v1/integrations/service-keys/${existingId}`)).toBe(true)
  expect(await page.content()).not.toContain("fixture-editor-token")
  expect(errors).toEqual([])
})

test("forbidden and unavailable states stay safe and retryable", async ({ page, context }) => {
  await authenticate(context, "fixture-forbidden-token")
  await page.goto("/preferencias/integracoes/lojas")
  await expect(page.getByRole("alert").filter({ hasText: "Sem permissão para gerenciar integrações" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Criar chave" })).toHaveCount(0)
  await context.clearCookies()
  await authenticate(context)
  unavailable = true
  await page.reload()
  await expect(page.getByRole("alert").filter({ hasText: "Serviço temporariamente indisponível" })).toBeVisible()
  unavailable = false
  await page.getByRole("button", { name: "Tentar novamente" }).click()
  await expect(page.getByText("Lojas produção", { exact: true })).toBeVisible()
})

test("mobile key management has no horizontal overflow and never captures the raw key", async ({ page, context }, testInfo) => {
  await authenticate(context)
  await page.setViewportSize({ width: 375, height: 844 })
  await page.goto("/preferencias/integracoes/lojas")
  await expect(page.getByText("Lojas produção", { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(await page.content()).not.toContain(rawKey)
  await page.screenshot({ path: testInfo.outputPath("service-keys-mobile.png"), fullPage: true })
})
