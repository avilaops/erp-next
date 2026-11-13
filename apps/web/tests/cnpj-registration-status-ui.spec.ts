import { expect, test } from "@playwright/test"
import { createServer } from "node:http"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"
import { companyFields, type CompanyData } from "../src/features/company/company-types"

const document = "04252011000110"
const secondDocument = "19131243000197"
const access = { tenant: { id: tenant }, permissions: ["catalog.parties.read", "catalog.parties.manage", "catalog.products.read", "sales.orders.read", "sales.orders.manage", "sales.opportunities.read", "sales.opportunities.manage", "platform.company.read", "platform.company.manage"] }
const party = { id: record, revision: 1, personType: "juridica", legalName: "Empresa sintética", tradeName: null, taxId: document, email: "manual@example.test", phone: "1133334444", isCustomer: true, isSupplier: true, status: "active", addresses: [], contacts: [] }
const reply = (value = document, code = "8") => ({ tenantId: tenant, kind: "cnpj", value, status: "found", source: "BrasilAPI", sourceUpdatedAt: null, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), cached: false, warnings: [], attempts: [], data: { fields: { legalName: "Empresa da fonte", tradeName: "Fantasia da fonte", registrationStatusCode: code, registrationStatus: code === "2" ? "ATIVA" : "BAIXADA", registrationStatusDate: "2026-04-15", registrationStatusReason: "Encerramento informado pela fonte" }, stateRegistrations: [], taxpayerStatus: "unknown", genericPostalCode: false } })
const upstream = createServer((_request, response) => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(access)) })
test.beforeAll(async () => { await new Promise<void>(resolve => upstream.listen(33941, "127.0.0.1", resolve)) })
test.afterAll(async () => { await new Promise<void>(resolve => upstream.close(() => resolve())) })
test.beforeEach(async ({ context }) => {
  await installFrontendFixture(context)
  await context.route("**/api/erp/me", route => route.fulfill({ json: access }))
  await context.route(/\/api\/erp\/opportunities\?/, route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: [], total: 0 } }))
  await context.route(/\/api\/erp\/parties\?/, route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: [party], total: 1 } }))
  await context.route(`**/api/erp/parties/${record}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: party } }))
  await context.route("**/api/erp/registry-lookups", route => route.fulfill({ json: reply(route.request().postDataJSON().value.replace(/\D/g, "")) }))
})

test("funnel shows closed registration before applying fields and keeps it visible afterwards", async ({ page }) => {
  const writes: string[] = []
  page.on("request", request => { if (request.method() !== "GET" && /\/api\/erp\/(?:parties|opportunities)(?:\?|$)/.test(request.url())) writes.push(request.url()) })
  await page.goto("/vendas/funil/nova")
  await page.getByLabel("CNPJ da empresa (opcional)", { exact: true }).fill(document)
  await page.getByRole("button", { name: "Consultar CNPJ", exact: true }).click()
  const notice = page.getByRole("alert", { name: "Situação cadastral do CNPJ", exact: true })
  await expect(notice).toContainText("BAIXADA")
  await expect(notice).toContainText("15/04/2026")
  await expect(notice).toContainText("Encerramento informado pela fonte")
  await expect(notice).toContainText("BrasilAPI")
  await page.getByRole("button", { name: "Preencher campos vazios", exact: true }).click()
  await expect(page.getByLabel("Empresa, se ainda não é cliente", { exact: true })).toHaveValue("Empresa da fonte")
  await expect(notice).toBeVisible()
  expect(writes).toEqual([])
})

for (const width of [393, 1280]) test(`existing party shows source registration independently of ERP active status at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 })
  let writes = 0
  page.on("request", request => { if (request.method() === "PUT" || request.method() === "PATCH") writes++ })
  await page.goto(`/cadastros/clientes-fornecedores/${record}`)
  await expect(page.getByText("Situação no ERP", { exact: true })).toBeVisible()
  await expect(page.getByRole("alert", { name: "Situação cadastral do CNPJ", exact: true })).toContainText("BAIXADA")
  await expect(page.getByText("Ativo", { exact: true })).toBeVisible()
  await expect(page.getByText("Cliente e fornecedor", { exact: true })).toBeVisible()
  expect(writes).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`party-registration-status-${width}.png`), fullPage: true })
})

test("automatic customer lookup preserves typed data and replaces the warning when the document changes", async ({ page, context }) => {
  await context.route("**/api/erp/registry-lookups", route => {
    const value = route.request().postDataJSON().value.replace(/\D/g, "")
    return route.fulfill({ json: reply(value, value === secondDocument ? "2" : "8") })
  })
  await page.goto("/cadastros/clientes-fornecedores/novo")
  await page.getByLabel("Nome ou razão social", { exact: true }).fill("Nome digitado")
  await page.getByLabel("CPF ou CNPJ", { exact: true }).fill(document)
  await expect(page.getByRole("alert", { name: "Situação cadastral do CNPJ", exact: true })).toContainText("BAIXADA")
  await expect(page.getByLabel("Nome ou razão social", { exact: true })).toHaveValue("Nome digitado")
  await expect(page.getByLabel("Situação no ERP", { exact: true })).toHaveValue("active")
  await page.getByLabel("CPF ou CNPJ", { exact: true }).fill(secondDocument)
  await expect(page.getByRole("alert", { name: "Situação cadastral do CNPJ", exact: true })).toHaveCount(0)
  await expect(page.getByRole("status", { name: "Situação cadastral do CNPJ", exact: true })).toContainText("ATIVA")
  await expect(page.getByLabel("Nome ou razão social", { exact: true })).toHaveValue("Nome digitado")
})

test("company onboarding shows the same warning without creating a company", async ({ page, context }) => {
  let writes = 0
  page.on("request", request => { if (request.method() === "POST" && /\/api\/erp\/companies$/.test(request.url())) writes++ })
  await context.route("**/api/erp/company-registration/lookup", route => route.fulfill({ json: reply(route.request().postDataJSON().value) }))
  await page.goto("/cadastro/empresa")
  await page.getByLabel("CPF ou CNPJ", { exact: true }).fill(document)
  await expect(page.getByRole("alert", { name: "Situação cadastral do CNPJ", exact: true })).toContainText("BAIXADA")
  expect(writes).toBe(0)
})

test("selecting an existing customer for an order checks registration without modifying the customer", async ({ page, context }) => {
  let writes = 0
  page.on("request", request => { if (request.method() !== "GET" && /\/api\/erp\/(?:parties|orders|commercial\/orders)(?:[/?]|$)/.test(request.url())) writes++ })
  await context.route(/\/api\/erp\/commercial\/tables\/imported(?:\?.*)?$/, route => route.fulfill({ json: { tenantId: tenant, line: "imported", authority: "seller", canManage: false, canCreateOrder: true, paymentMethods: [], data: { id: "55555555-5555-4555-8555-555555555555", version: 41, publishedAt: "2026-11-12T12:00:00Z", originState: "SP", freeDiscountBps: 2000, minimumDownPaymentBps: 7000, items: [] } } }))
  await page.goto("/vendas/pedidos/novo")
  await page.getByRole("button", { name: "Buscar cliente", exact: true }).click()
  await page.getByRole("button", { name: "Pesquisar cliente", exact: true }).click()
  await page.getByRole("button", { name: "Selecionar Empresa sintética", exact: true }).click()
  await expect(page.getByRole("alert", { name: "Situação cadastral do CNPJ", exact: true })).toContainText("BAIXADA")
  expect(writes).toBe(0)
})

test("a manual lookup cannot display registration from a different session", async ({ page, context }) => {
  await page.goto("/vendas/funil/nova")
  await context.route("**/api/erp/me", route => route.fulfill({ json: { ...access, tenant: { id: "99999999-9999-4999-8999-999999999999" } } }))
  await page.getByLabel("CNPJ da empresa (opcional)", { exact: true }).fill(document)
  await page.getByRole("button", { name: "Consultar CNPJ", exact: true }).click()
  await expect(page.getByText("A empresa da sessão ou o documento mudou. Consulte novamente; os campos foram preservados", { exact: true })).toBeVisible()
  await expect(page.getByRole("alert", { name: "Situação cadastral do CNPJ", exact: true })).toHaveCount(0)
})

test("company manual preview is removed when its uncontrolled CNPJ changes", async ({ page, context }) => {
  const data = { ...Object.fromEntries(companyFields.map(field => [field, ""])) as Record<typeof companyFields[number], string>, legalName: "Empresa digitada", personType: "juridica", taxId: document, taxRegime: "simples", state: "SP", segments: [], substituteRegistrations: [] } as CompanyData
  await context.route("**/api/erp/company", route => route.fulfill({ json: { tenantId: tenant, revision: 1, canEdit: true, data } }))
  await context.route("**/api/erp/registry-lookups", route => {
    const value = route.request().postDataJSON().value.replace(/\D/g, "")
    return route.fulfill({ json: reply(value, value === document ? "2" : "8") })
  })
  await page.goto("/preferencias/empresa/dados")
  await page.getByLabel("Nome fantasia", { exact: true }).fill("Nome manual")
  await page.getByRole("button", { name: "Consultar CNPJ", exact: true }).click()
  await expect(page.getByText("ATIVA", { exact: false }).first()).toBeVisible()
  await page.getByLabel("CPF ou CNPJ", { exact: true }).fill(secondDocument)
  await expect(page.getByRole("alert", { name: "Situação cadastral do CNPJ", exact: true })).toContainText("BAIXADA")
  await expect(page.getByText("Situação cadastral do CNPJ: ATIVA", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Preencher campos vazios", exact: true })).toHaveCount(0)
})

test("unavailable registration is not presented as active and can be checked again", async ({ page, context }) => {
  let unavailable = true
  await context.route("**/api/erp/registry-lookups", route => unavailable ? route.fulfill({ status: 503, json: { title: "Fonte indisponível" } }) : route.fulfill({ json: reply() }))
  await page.goto(`/cadastros/clientes-fornecedores/${record}`)
  await expect(page.getByText("Não foi possível conferir a situação cadastral do CNPJ. Os dados salvos foram preservados.", { exact: true })).toBeVisible()
  await expect(page.getByRole("alert", { name: "Situação cadastral do CNPJ", exact: true })).toHaveCount(0)
  unavailable = false
  await page.getByRole("button", { name: "Conferir situação cadastral", exact: true }).click()
  await expect(page.getByRole("alert", { name: "Situação cadastral do CNPJ", exact: true })).toContainText("BAIXADA")
})
