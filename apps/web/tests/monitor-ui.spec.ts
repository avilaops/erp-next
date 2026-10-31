import { expect, test } from "@playwright/test"
import { createServer } from "node:http"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import type { BrowserContext } from "@playwright/test"
import { tenant } from "./helpers/frontend-fixture"
import { secret } from "../playwright.danfe.config"
import { monitorOrigin as origin } from "../playwright.monitor.config"

async function installFrontendFixture(context: BrowserContext) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const data = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "fixture-monitor", tenantId: tenant, expiresAt: Date.now() + 3600_000 })), cipher.final()])
  await context.addCookies([{ name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" }])
  await context.route("**/api/erp/**", route => route.fulfill({ status: 503, json: { title: "Serviço indisponível" } }))
}

let collected = 0
let showManifestation = false
let manifested = false
const upstream = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json")
  if (request.url === "/api/v1/fiscal/monitor/documents/1/manifest" && request.method === "POST") {
    let body = ""
    for await (const chunk of request) body += chunk
    expect(JSON.parse(body)).toEqual({ eventType: "210210", justification: null })
    expect(request.headers["x-tenant-id"]).toBe(tenant)
    expect(request.headers["idempotency-key"]).toMatch(/^[a-f0-9-]{36}$/)
    manifested = true
    response.statusCode = 202
    return response.end(JSON.stringify({ outcome: "unknown", eventType: "210210", protocol: null }))
  }
  if (request.url === "/api/v1/fiscal/monitor" && showManifestation) return response.end(JSON.stringify({ tenantId: tenant, canSync: false, canManifest: true, collectionEnabled: true, certificateReady: true, lastNsu: "000000000000007", maxNsu: "000000000000007", nextQueryAt: null, lastStatus: "138", total: 1, lastRun: null, documents: [{ id: 1, nsu: "000000000000007", schema: "resNFe_v1.01.xsd", kind: "summary", accessKey: "35261004252011000110550010000000011000000017", issuerName: "Fornecedor sintético", situation: "1", totalCents: 1001, receivedNfeId: null, manifestations: manifested ? [{ id: "event-1", eventType: "210210", outcome: "unknown", status: null, protocol: null }] : [] }] }))
  if (request.url === "/api/v1/fiscal/monitor" && request.method === "GET") return response.end(JSON.stringify({ tenantId: tenant, canSync: true, canManifest: false, collectionEnabled: true, certificateReady: true, lastNsu: "000000000000007", maxNsu: "000000000000009", nextQueryAt: null, lastStatus: null, documents: [], total: 0, lastRun: null }))
  if (request.url === "/api/v1/fiscal/monitor/sync" && request.method === "POST") {
    collected++
    expect(request.headers["x-tenant-id"]).toBe(tenant)
    expect(request.headers["idempotency-key"]).toMatch(/^[a-f0-9-]{36}$/)
    response.statusCode = 202
    return response.end(JSON.stringify({ outcome: "applied", status: "137", documentCount: 0 }))
  }
  response.statusCode = 404; response.end(JSON.stringify({ title: "Recurso indisponível" }))
})
test.beforeAll(async () => { await new Promise<void>(resolve => upstream.listen(33929, "127.0.0.1", resolve)) })
test.afterAll(async () => { await new Promise<void>(resolve => upstream.close(() => resolve())) })
test.beforeEach(() => { collected = 0; showManifestation = false; manifested = false })

test("coleta usa BFF autenticado, preserva empresa e nunca recebe cursor do navegador", async ({ page, context }) => {
  await installFrontendFixture(context)
  await context.unroute("**/api/erp/**")
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant, legalName: "Empresa sintética" }, permissions: [] } }))
  await page.route("**/api/erp/fiscal/received-nfes?*", route => route.fulfill({ json: { tenantId: tenant, canImport: true, data: [], total: 0 } }))
  await page.goto("/fiscal/monitor")
  await expect(page.getByText("000000000000007", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Consultar SEFAZ", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Lote consultado" })).toBeVisible()
  expect(collected).toBe(1)
  expect((await context.request.post("/api/erp/fiscal/monitor/sync", { headers: { Origin: "https://outside.example", "X-Tenant-Id": tenant }, data: {} })).status()).toBe(403)
  expect((await context.request.post("/api/erp/fiscal/monitor/sync", { headers: { Origin: origin, "X-Tenant-Id": "22222222-2222-4222-8222-222222222222" }, data: {} })).status()).toBe(409)
  expect(collected).toBe(1)
})

test("mobile mostra pausa, resumos e falha sem oferecer manifestação automática", async ({ page, context }) => {
  await installFrontendFixture(context)
  await page.route("**/api/erp/fiscal/monitor", route => route.fulfill({ json: { tenantId: tenant, canSync: true, canManifest: false, collectionEnabled: true, certificateReady: true, lastNsu: "000000000000007", maxNsu: "000000000000007", nextQueryAt: new Date(Date.now() + 3600_000).toISOString(), lastStatus: "137", total: 1, lastRun: { outcome: "failed" }, documents: [{ id: 1, nsu: "000000000000007", schema: "resNFe_v1.01.xsd", kind: "summary", accessKey: "35261004252011000110550010000000011000000017", issuerName: "Fornecedor sintético", totalCents: 1001, receivedNfeId: null, manifestations: [] }] } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/fiscal/monitor")
  await expect(page.getByText("Fornecedor sintético", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Consultar SEFAZ", exact: true })).toBeDisabled()
  await expect(page.getByText(/Próxima consulta/)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(collected).toBe(0)
})

test("manifestação exige seleção e confirmação explícitas e conserva resultado desconhecido", async ({ page, context }) => {
  showManifestation = true
  await installFrontendFixture(context)
  await context.unroute("**/api/erp/**")
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant, legalName: "Empresa sintética" }, permissions: [] } }))
  await page.route("**/api/erp/fiscal/received-nfes?*", route => route.fulfill({ json: { tenantId: tenant, canImport: true, data: [], total: 0 } }))
  await page.goto("/fiscal/monitor")
  await page.getByText("Manifestar esta NF-e", { exact: true }).click()
  const submit = page.getByRole("button", { name: "Enviar manifestação à SEFAZ", exact: true })
  await expect(submit).toBeDisabled()
  await page.getByLabel("Evento de manifestação", { exact: true }).selectOption("210210")
  await expect(submit).toBeDisabled()
  expect(manifested).toBe(false)
  await page.getByLabel("Confirmo o envio deste evento à SEFAZ para esta NF-e.").check()
  await submit.click()
  await expect(page.getByText(/Resultado não confirmado — conferir/)).toBeVisible()
  await expect(submit).toBeDisabled()
  expect(manifested).toBe(true)
  expect(collected).toBe(0)
})
