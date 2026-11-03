import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"
import { companyFields } from "../src/features/company/company-types"
import { origin, secret } from "../playwright.danfe.config"
import { createServer } from "node:http"
import { createCipheriv, createHash, randomBytes } from "node:crypto"

const party = { id: record, revision: 1, personType: "juridica", legalName: "Nome editado", tradeName: null, taxId: "12ABC34501DE35", email: null, phone: null, isCustomer: true, isSupplier: false, status: "active", addresses: [], contacts: [] }
const reply = (kind: string, value: string) => ({ tenantId: tenant, kind, value, status: "found", source: "BrasilAPI", sourceUpdatedAt: null, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400_000).toISOString(), cached: false, attempts: [], warnings: [], data: { fields: kind === "cep" ? { state: "SP", city: "São Paulo", street: "Praça da Sé", district: "Sé", postalCode: value } : { legalName: "Nome da fonte", tradeName: "Fantasia da fonte" }, stateRegistrations: [], taxpayerStatus: "unknown", genericPostalCode: false } })
let upstreamCalls = 0
const upstream = createServer(async (request, response) => {
  if (request.url === "/api/v1/me") {
    response.setHeader("Content-Type", "application/json")
    response.end(JSON.stringify({ tenantId: request.headers["x-tenant-id"] }))
    return
  }
  upstreamCalls++
  expect(request.url).toBe("/api/v1/registry-lookups")
  expect(request.headers.authorization).toBe("Bearer frontend-integration-fixture")
  expect(request.headers["x-tenant-id"]).toBe(tenant)
  let raw = ""; for await (const chunk of request) raw += chunk
  const input = JSON.parse(raw)
  response.setHeader("Content-Type", "application/json")
  response.end(JSON.stringify(reply(input.kind, input.value)))
})
test.beforeAll(async () => { await new Promise<void>(resolve => upstream.listen(33941, "127.0.0.1", resolve)) })
test.afterAll(async () => { await new Promise<void>(resolve => upstream.close(() => resolve())) })

test.beforeEach(async ({ context }) => {
  await installFrontendFixture(context)
  await context.route("**/api/erp/me", route => route.fulfill({ json: { tenantId: tenant } }))
  await context.route(`**/api/erp/parties/${record}`, route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: party }, headers: { etag: '"1"' } }))
  await context.route("**/api/erp/registry-lookups", route => {
    const body = route.request().postDataJSON()
    expect(route.request().headers()["x-tenant-id"]).toBe(tenant)
    return route.fulfill({ json: reply(body.kind, body.value.replace(/[^0-9A-Z]/gi, "").toUpperCase()) })
  })
  await context.route("**/api/erp/company", route => route.fulfill({ json: { tenantId: tenant, revision: 1, canEdit: true, data: {
    ...Object.fromEntries(companyFields.map(field => [field, ""])), legalName: "Empresa manual", personType: "juridica", taxId: "12ABC34501DE35", postalCode: "01001000", street: "Rua manual", taxRegime: "simples", segments: ["Comércio"], substituteRegistrations: [],
  } }, headers: { etag: '"1"' } }))
})

test("BFF verifies origin, session tenant, query and method before forwarding", async ({ page }) => {
  upstreamCalls = 0
  const headers = { origin, "x-tenant-id": tenant }
  const data = { kind: "cep", value: "01001000", context: "company" }
  expect((await page.request.post("/api/erp/registry-lookups", { headers: { ...headers, origin: "https://other.example" }, data })).status()).toBe(403)
  expect((await page.request.post("/api/erp/registry-lookups", { headers: { ...headers, "x-tenant-id": record }, data })).status()).toBe(409)
  expect((await page.request.post("/api/erp/registry-lookups?value=01001000", { headers, data })).status()).toBe(400)
  expect((await page.request.get("/api/erp/registry-lookups")).status()).toBe(405)
  expect(upstreamCalls).toBe(0)
  const response = await page.request.post("/api/erp/registry-lookups", { headers, data })
  expect(response.status()).toBe(200)
  expect((await response.json()).tenantId).toBe(tenant)
  expect(response.headers()["cache-control"]).toContain("no-store")
  expect(upstreamCalls).toBe(1)
})

test("CNPJ preview requires confirmation and preserves edited names", async ({ page }) => {
  await page.goto(`/cadastros/clientes-fornecedores/${record}/editar`)
  await page.getByRole("button", { name: "Consultar CNPJ", exact: true }).click()
  await expect(page.getByText("Fantasia da fonte", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Nome fantasia", { exact: true })).toHaveValue("")
  await page.getByRole("button", { name: "Preencher campos vazios", exact: true }).click()
  await expect(page.getByLabel("Nome fantasia", { exact: true })).toHaveValue("Fantasia da fonte")
  await expect(page.getByLabel("Nome ou razão social", { exact: true })).toHaveValue("Nome editado")
})

test("a session switched in another tab prevents applying the old company preview", async ({ page, context }) => {
  await page.goto(`/cadastros/clientes-fornecedores/${record}/editar`)
  await page.getByRole("button", { name: "Consultar CNPJ", exact: true }).click()
  await expect(page.getByText("Fantasia da fonte", { exact: true })).toBeVisible()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const bytes = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "frontend-integration-fixture", tenantId: record, expiresAt: Date.now() + 3600_000 })), cipher.final()])
  await context.addCookies([{ name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" }])
  await context.unroute("**/api/erp/me")
  // Let the actual BFF read the shared cookie and forward the newly active tenant.
  await context.route("**/api/erp/me", route => route.fallback())
  await context.route("**/api/erp/**", route => route.request().url().endsWith("/api/erp/me") ? route.continue() : route.fallback())
  await page.getByRole("button", { name: "Preencher campos vazios", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "empresa da sessão mudou" })).toBeVisible()
  await expect(page.getByLabel("Nome fantasia", { exact: true })).toHaveValue("")
})

test("session confirmation prevents dismissal races and rechecks edits made while waiting", async ({ page, context }) => {
  let release!: () => void
  let received!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { received = resolve })
  await page.goto(`/cadastros/clientes-fornecedores/${record}/editar`)
  await page.getByRole("button", { name: "Consultar CNPJ", exact: true }).click()
  await expect(page.getByText("Fantasia da fonte", { exact: true })).toBeVisible()
  await context.route("**/api/erp/me", async route => {
    received(); await gate
    await route.fulfill({ json: { tenantId: tenant } })
  })
  await page.getByRole("button", { name: "Preencher campos vazios", exact: true }).click()
  await started
  try {
    await expect(page.getByRole("button", { name: "Dispensar prévia", exact: true })).toBeDisabled()
    await page.getByLabel("CPF ou CNPJ", { exact: true }).fill("04252011000110")
  } finally { release() }
  await expect(page.getByRole("status").filter({ hasText: "documento, CEP ou empresa mudou" })).toBeVisible()
  await expect(page.getByLabel("Nome fantasia", { exact: true })).toHaveValue("")
})

test("changed CEP invalidates a pending preview and unavailable lookup keeps manual entry", async ({ page, context }) => {
  await page.goto(`/cadastros/clientes-fornecedores/${record}/editar`)
  await page.getByRole("button", { name: "Adicionar endereço", exact: true }).click()
  await page.getByLabel("Endereço 1: CEP", { exact: true }).fill("01001000")
  await page.getByRole("button", { name: "Consultar CEP", exact: true }).click()
  await expect(page.getByText("Praça da Sé", { exact: true })).toBeVisible()
  await page.getByLabel("Endereço 1: CEP", { exact: true }).fill("20040002")
  await page.getByRole("button", { name: "Preencher campos vazios", exact: true }).click()
  await expect(page.getByLabel("Endereço 1: Rua", { exact: true })).toHaveValue("")
  await context.route("**/api/erp/registry-lookups", route => route.fulfill({ status: 503, json: { title: "Consulta indisponível" } }))
  await page.getByRole("button", { name: "Consultar CEP", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Consulta indisponível" })).toBeVisible()
  await page.getByLabel("Endereço 1: Rua", { exact: true }).fill("Rua manual")
  await expect(page.getByLabel("Endereço 1: Rua", { exact: true })).toHaveValue("Rua manual")
})

test("late CNPJ result and a response for another tenant never fill a changed form", async ({ page, context }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let received!: () => void
  const started = new Promise<void>(resolve => { received = resolve })
  await context.route("**/api/erp/registry-lookups", async route => {
    const body = route.request().postDataJSON()
    received(); await gate
    await route.fulfill({ json: reply(body.kind, body.value) })
  })
  await page.goto(`/cadastros/clientes-fornecedores/${record}/editar`)
  await page.getByRole("button", { name: "Consultar CNPJ", exact: true }).click()
  await started
  await page.getByLabel("CPF ou CNPJ", { exact: true }).fill("04252011000110")
  release()
  await expect(page.getByRole("status").filter({ hasText: "mudou" })).toBeVisible()
  await expect(page.getByLabel("Nome fantasia", { exact: true })).toHaveValue("")
  await context.route("**/api/erp/registry-lookups", route => route.fulfill({ json: { ...reply("cnpj", "04252011000110"), tenantId: record } }))
  await page.getByRole("button", { name: "Consultar CNPJ", exact: true }).click()
  await expect(page.getByRole("button", { name: "Preencher campos vazios", exact: true })).toHaveCount(0)
  await expect(page.getByLabel("Nome fantasia", { exact: true })).toHaveValue("")
})

test("expired company preview is rejected and read-only company cannot consult", async ({ page, context }) => {
  await context.route("**/api/erp/registry-lookups", route => route.fulfill({ json: { ...reply("cep", "01001000"), expiresAt: "2000-01-01T00:00:00Z" } }))
  await page.goto("/preferencias/empresa/dados?secao=endereco")
  await page.getByRole("button", { name: "Consultar CEP", exact: true }).click()
  await page.getByRole("button", { name: "Preencher campos vazios", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "venceu" })).toBeVisible()
  await expect(page.getByLabel("Cidade *", { exact: true })).toHaveValue("")
  await context.route("**/api/erp/company", route => route.fulfill({ json: { tenantId: tenant, revision: 1, canEdit: false, data: { ...Object.fromEntries(companyFields.map(field => [field, ""])), personType: "juridica", segments: [], substituteRegistrations: [] } }, headers: { etag: '"1"' } }))
  await page.reload()
  await expect(page.getByRole("button", { name: "Consultar CEP", exact: true })).toBeDisabled()
})

for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1280, 900], [1920, 1080]]) {
  test(`company CEP preserves manual street and supports confirmation at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto("/preferencias/empresa/dados?secao=endereco")
    await page.getByRole("button", { name: "Consultar CEP", exact: true }).click()
    await expect(page.getByText("Praça da Sé", { exact: true })).toBeVisible()
    await expect(page.getByLabel("Cidade *", { exact: true })).toHaveValue("")
    await page.getByRole("button", { name: "Preencher campos vazios", exact: true }).click()
    await expect(page.getByLabel("Cidade *", { exact: true })).toHaveValue("São Paulo")
    await expect(page.getByLabel("Endereço *", { exact: true })).toHaveValue("Rua manual")
    await expect(page.getByRole("combobox", { name: "UF *", exact: true })).toHaveValue("SP")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" })
    const violations = await page.evaluate(async () => (await (window as unknown as { axe: { run: (target: string, options: unknown) => Promise<{ violations: unknown[] }> } }).axe.run("main", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations)
    expect(violations).toEqual([])
  })
  test(`CEP confirmation preserves manual edits and remains accessible at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto(`/cadastros/clientes-fornecedores/${record}/editar`)
    await page.getByRole("button", { name: "Adicionar endereço", exact: true }).click()
    await page.getByLabel("Endereço 1: CEP", { exact: true }).fill("01001000")
    await page.getByRole("button", { name: "Consultar CEP", exact: true }).click()
    await expect(page.getByText("Praça da Sé", { exact: true })).toBeVisible()
    await page.getByLabel("Endereço 1: Rua", { exact: true }).fill("Rua digitada durante a consulta")
    await page.getByRole("button", { name: "Preencher campos vazios", exact: true }).click()
    await expect(page.getByLabel("Endereço 1: Rua", { exact: true })).toHaveValue("Rua digitada durante a consulta")
    await expect(page.getByLabel("Endereço 1: Cidade", { exact: true })).toHaveValue("São Paulo")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" })
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (target: string, options: unknown) => Promise<{ violations: { id: string; impact: string }[] }> } }).axe
      return (await axe.run("main", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations
    })
    expect(violations).toEqual([])
  })
}
