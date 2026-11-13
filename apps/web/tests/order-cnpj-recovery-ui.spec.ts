import { expect, test } from "@playwright/test"
import { createServer } from "node:http"
import { installFrontendFixture, tenant } from "./helpers/frontend-fixture"
import { origin } from "../playwright.danfe.config"

const taxId = "04252011000110"
const access = { tenant: { id: tenant }, permissions: ["sales.orders.read", "sales.orders.manage", "catalog.parties.read", "catalog.parties.manage", "catalog.products.read"] }
const found = (value = taxId) => ({ tenantId: tenant, kind: "cnpj", value, status: "found", source: "BrasilAPI", sourceUpdatedAt: null, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), cached: false, attempts: [], warnings: [], data: { fields: { legalName: "Empresa da fonte", tradeName: "Fantasia da fonte" }, stateRegistrations: [], taxpayerStatus: "unknown", genericPostalCode: false } })
let upstreamBody = "", upstreamStatus = 200
const upstream = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json")
  if (request.url === "/api/v1/me") return response.end(JSON.stringify(access))
  response.statusCode = upstreamStatus
  response.end(upstreamBody)
})
test.beforeAll(async () => { await new Promise<void>(resolve => upstream.listen(33941, "127.0.0.1", resolve)) })
test.afterAll(async () => { await new Promise<void>(resolve => upstream.close(() => resolve())) })
test.beforeEach(async ({ context }) => {
  await installFrontendFixture(context)
  await context.route("**/api/erp/me", route => route.fulfill({ json: access }))
  await context.route(/\/api\/erp\/commercial\/tables\/imported(?:\?.*)?$/, route => route.fulfill({ json: { tenantId: tenant, line: "imported", authority: "seller", canManage: false, canCreateOrder: true, paymentMethods: [], data: { id: "55555555-5555-4555-8555-555555555555", version: 41, publishedAt: "2026-11-12T12:00:00Z", originState: "SP", freeDiscountBps: 2000, minimumDownPaymentBps: 7000, items: [] } } }))
})

for (const width of [393, 1280]) test(`new order recovers an empty lookup at ${width}px and preserves manual fields`, async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: 900 })
  let queries = 0, writes = 0
  page.on("request", request => { if (request.method() !== "GET" && /\/api\/erp\/(?:parties|orders|commercial\/orders)(?:\?|$)/.test(request.url())) writes++ })
  await context.route("**/api/erp/registry-lookups", route => {
    queries++
    expect(route.request().postDataJSON()).toMatchObject({ kind: "cnpj", context: "party", value: expect.any(String) })
    expect(route.request().headers()["x-tenant-id"]).toBe(tenant)
    return queries === 1 ? route.fulfill({ status: 200, contentType: "application/json", body: "" }) : route.fulfill({ json: found() })
  })
  await page.goto("/vendas/pedidos/novo")
  await page.getByRole("button", { name: "Cadastrar cliente", exact: true }).click()
  await page.getByLabel("Razão social", { exact: true }).fill("Nome já digitado")
  await page.getByLabel("CNPJ", { exact: true }).fill(taxId)
  await expect(page.getByLabel("Nome fantasia", { exact: true })).toHaveValue("Fantasia da fonte")
  await expect(page.getByLabel("Razão social", { exact: true })).toHaveValue("Nome já digitado")
  await expect(page.getByText(/Unexpected|JSON input/)).toHaveCount(0)
  expect(queries).toBe(2); expect(writes).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`cnpj-recovered-${width}.png`), fullPage: true })
})

test("new order recovers empty session verification but never applies a foreign tenant result", async ({ page, context }) => {
  let sessionChecks = 0, foreign = false
  await context.route("**/api/erp/registry-lookups", route => route.fulfill({ json: found(route.request().postDataJSON().value.replace(/\D/g, "")) }))
  await page.goto("/vendas/pedidos/novo")
  await page.getByRole("button", { name: "Cadastrar cliente", exact: true }).click()
  await context.route("**/api/erp/me", route => ++sessionChecks === 1 ? route.fulfill({ body: "", contentType: "application/json" }) : route.fulfill({ json: foreign ? { ...access, tenant: { id: "99999999-9999-4999-8999-999999999999" } } : access }))
  await page.getByLabel("CNPJ", { exact: true }).fill(taxId)
  await expect(page.getByLabel("Nome fantasia", { exact: true })).toHaveValue("Fantasia da fonte")
  expect(sessionChecks).toBe(2)
  foreign = true
  await page.getByLabel("Nome fantasia", { exact: true }).fill("")
  await page.getByRole("button", { name: "Consultar CNPJ", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "empresa da sessão mudou" })).toBeVisible()
  await expect(page.getByLabel("Nome fantasia", { exact: true })).toHaveValue("")
})

test("persistent empty lookup gives a usable error, permits retry, and keeps typed fields", async ({ page, context }) => {
  let queries = 0, recover = false
  await context.route("**/api/erp/registry-lookups", route => { queries++; return recover ? route.fulfill({ json: found() }) : route.fulfill({ contentType: "application/json", body: "" }) })
  await page.goto("/vendas/pedidos/novo")
  await page.getByRole("button", { name: "Cadastrar cliente", exact: true }).click()
  await page.getByLabel("Razão social", { exact: true }).fill("Dado preservado")
  await page.getByLabel("CNPJ", { exact: true }).fill(taxId)
  await expect(page.getByRole("alert").filter({ hasText: "Consulta indisponível" })).toBeVisible()
  expect(queries).toBe(2)
  await expect(page.getByLabel("Razão social", { exact: true })).toHaveValue("Dado preservado")
  recover = true
  await page.getByRole("button", { name: "Consultar CNPJ", exact: true }).click()
  await expect(page.getByLabel("Nome fantasia", { exact: true })).toHaveValue("Fantasia da fonte")
  expect(queries).toBe(3)
})

test("BFF returns JSON for empty, truncated and HTML registry replies while preserving refusals", async ({ page }) => {
  for (const body of ["", "{", "<html>gateway</html>", "null", "[]"]) {
    upstreamBody = body; upstreamStatus = 200
    const response = await page.request.post("/api/erp/registry-lookups", { headers: { origin, "x-tenant-id": tenant }, data: { kind: "cnpj", context: "party", value: taxId } })
    expect(response.status()).toBe(502)
    expect((await response.json()).title).toContain("Consulta cadastral indisponível")
    expect(response.headers()["cache-control"]).toContain("no-store")
  }
  upstreamBody = ""; upstreamStatus = 401
  const response = await page.request.post("/api/erp/registry-lookups", { headers: { origin, "x-tenant-id": tenant }, data: { kind: "cnpj", context: "party", value: taxId } })
  expect(response.status()).toBe(401)
  expect((await response.json()).title).toContain("Consulta cadastral indisponível")
})
