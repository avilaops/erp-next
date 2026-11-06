import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"
import { companyFields } from "../src/features/company/company-types"
import { origin } from "../playwright.danfe.config"
import { createServer } from "node:http"
import type { Schema } from "../src/lib/api/types"

const party = { id: record, revision: 1, personType: "juridica", legalName: "Nome editado", tradeName: null, taxId: "12ABC34501DE35", email: null, phone: null, isCustomer: true, isSupplier: false, status: "active", addresses: [], contacts: [] }
const access = (tenantId: string): Schema<"CurrentAccessResponse"> => ({
  identity: { subject: "fixture", email: "fixture@example.test", name: "Fixture" },
  tenant: { id: tenantId, legalName: "Empresa sintética", tradeName: null },
  roles: [], permissions: ["platform.company.read", "catalog.parties.read"],
})
const reply = (kind: string, value: string) => ({ tenantId: tenant, kind, value, status: "found", source: "BrasilAPI", sourceUpdatedAt: null, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400_000).toISOString(), cached: false, attempts: [], warnings: [], data: { fields: kind === "cep" ? { state: "SP", city: "São Paulo", street: "Praça da Sé", district: "Sé", postalCode: value } : { legalName: "Nome da fonte", tradeName: "Fantasia da fonte" }, stateRegistrations: [], taxpayerStatus: "unknown", genericPostalCode: false } })
let upstreamCalls = 0
const upstream = createServer(async (request, response) => {
  if (request.url === "/api/v1/me") {
    response.setHeader("Content-Type", "application/json")
    response.end(JSON.stringify(access(String(request.headers["x-tenant-id"]))))
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
  await context.route("**/api/erp/me", route => route.fulfill({ json: access(tenant) }))
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

test("company CNPJ automatically fills contacts and fiscal activity across sections without saving", async ({ page, context }) => {
  let saves = 0
  await context.route("**/api/erp/company", route => {
    if (route.request().method() === "PUT") saves++
    return route.fulfill({ json: { tenantId: tenant, revision: 1, canEdit: true, data: { ...Object.fromEntries(companyFields.map(field => [field, ""])), legalName: "Empresa manual", personType: "juridica", taxId: "04252011000110", taxRegime: "real", segments: ["Comércio"], substituteRegistrations: [] } }, headers: { etag: '"1"' } })
  })
  await context.route("**/api/erp/registry-lookups", route => route.fulfill({ json: { ...reply("cnpj", "04252011000110"), data: { fields: { legalName: "Fonte", tradeName: "Fantasia automática", email: "contato@example.test", phone: "1133334444", cnae: "6201501", activityDescription: "Atividade da fonte", companySize: "micro", state: "SP" }, stateRegistrations: [], taxpayerStatus: "unknown", genericPostalCode: false } } }))
  await page.goto("/preferencias/empresa/dados")
  await expect(page.getByLabel("Nome fantasia", { exact: true })).toHaveValue("Fantasia automática")
  await expect(page.getByLabel("Nome empresarial *", { exact: true })).toHaveValue("Empresa manual")
  await page.getByRole("button", { name: "Dados fiscais e atividade", exact: true }).click()
  await expect(page.locator("input[name=cnae]")).toHaveValue("6201501")
  await expect(page.locator("select[name=companySize]")).toHaveValue("micro")
  await expect(page.locator("select[name=taxRegime]")).toHaveValue("real")
  await expect(page.locator("input[name=email]")).toHaveValue("contato@example.test")
  await expect(page.locator("input[name=phone]")).toHaveValue("1133334444")
  expect(saves).toBe(0)
})

test("changed CEP invalidates a pending preview and unavailable lookup keeps manual entry", async ({ page, context }) => {
  await page.goto(`/cadastros/clientes-fornecedores/${record}/editar`)
  await expect(page.getByLabel("Nome fantasia", { exact: true })).toHaveValue("Fantasia da fonte")
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
    // Audit settled colors after lookup buttons transition from disabled to enabled.
    await page.locator("main").evaluate(async main => {
      await Promise.all(main.getAnimations({ subtree: true })
        .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => undefined)))
    })
    await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" })
    const violations = await page.evaluate(async () => (await (window as unknown as { axe: { run: (target: string, options: unknown) => Promise<{ violations: unknown[] }> } }).axe.run("main", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations)
    expect(violations).toEqual([])
  })
  test(`CEP confirmation preserves manual edits and remains accessible at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto(`/cadastros/clientes-fornecedores/${record}/editar`)
    await expect(page.getByLabel("Nome fantasia", { exact: true })).toHaveValue("Fantasia da fonte")
    await page.getByRole("button", { name: "Adicionar endereço", exact: true }).click()
    await page.getByLabel("Endereço 1: CEP", { exact: true }).fill("01001000")
    await page.getByRole("button", { name: "Consultar CEP", exact: true }).click()
    await expect(page.getByText("Praça da Sé", { exact: true })).toBeVisible()
    await page.getByLabel("Endereço 1: Rua", { exact: true }).fill("Rua digitada durante a consulta")
    await page.getByRole("button", { name: "Preencher campos vazios", exact: true }).click()
    await expect(page.getByLabel("Endereço 1: Rua", { exact: true })).toHaveValue("Rua digitada durante a consulta")
    await expect(page.getByLabel("Endereço 1: Cidade", { exact: true })).toHaveValue("São Paulo")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    // Audit settled colors after lookup buttons transition from disabled to enabled.
    await page.locator("main").evaluate(async main => {
      await Promise.all(main.getAnimations({ subtree: true })
        .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => undefined)))
    })
    await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" })
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (target: string, options: unknown) => Promise<{ violations: { id: string; impact: string }[] }> } }).axe
      return (await axe.run("main", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations
    })
    expect(violations).toEqual([])
  })
}
