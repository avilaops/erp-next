import { expect, test, type Page } from "@playwright/test"
import { createServer } from "node:http"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"
import { origin } from "../playwright.danfe.config"

test.setTimeout(process.env.ERP_BROWSER_DEV === "1" ? 60_000 : 15_000)
const path = "/cadastros/clientes-fornecedores"
const first = "04252011000110"
const second = "19131243000197"
const initial = () => ({ id: record, revision: 1, personType: "juridica", legalName: "Nome editado", tradeName: null as string | null, taxId: "", email: null as string | null, phone: null as string | null, isCustomer: true, isSupplier: false, status: "active", addresses: [] as Record<string, unknown>[], contacts: [] })
let party = initial()
let canEdit = true
let sourceStatus = 200
let replyTenant = tenant
let sessionTenant = tenant
let expiresAt: string | null = null
let requests: string[] = []
let writes = 0
let gate: Promise<void> | null = null
let heldDocument = ""
const source = (value: string) => ({
  tenantId: replyTenant, kind: "cnpj", value, status: "found", source: "BrasilAPI", sourceUpdatedAt: "2026-11-01T00:00:00Z", fetchedAt: new Date().toISOString(), expiresAt: expiresAt || new Date(Date.now() + 3600_000).toISOString(), cached: false, attempts: [], warnings: [],
  data: { fields: { legalName: "Empresa da fonte", tradeName: `Fantasia ${value.slice(0, 2)}`, email: "contato@example.test", phone: "1133334444", postalCode: "01001000", state: "SP", city: "São Paulo", street: "Rua cadastral", number: value.slice(0, 2), district: "Centro", complement: "Sala 2" }, stateRegistrations: [], taxpayerStatus: "unknown", genericPostalCode: false },
})
const upstream = createServer(async (request, response) => {
  expect(request.headers.authorization).toBe("Bearer frontend-integration-fixture")
  expect(request.headers["x-tenant-id"]).toBe(request.url === "/api/v1/me" && request.headers["x-tenant-id"] === record ? record : tenant)
  response.setHeader("Content-Type", "application/json")
  if (request.url === "/api/v1/me") {
    response.end(JSON.stringify({ identity: { subject: "fixture", email: "fixture@example.test", name: "Fixture" }, tenant: { id: request.headers["x-tenant-id"] === record ? record : sessionTenant, legalName: "Empresa de teste", tradeName: null }, roles: [], permissions: ["catalog.parties.read", ...(canEdit ? ["catalog.parties.manage"] : [])] })); return
  }
  if (request.url?.startsWith("/api/v1/registration-settings/")) {
    response.end(JSON.stringify({ tenantId: tenant, revision: 1, canEdit, data: { labels: [] } })); return
  }
  if (request.url === "/api/v1/registry-lookups") {
    let raw = ""; for await (const chunk of request) raw += chunk
    const input = JSON.parse(raw)
    if (input.kind === "cep") {
      const value = input.value.replace(/\D/g, "")
      response.end(JSON.stringify({ tenantId: replyTenant, kind: "cep", value, status: "found", expiresAt: expiresAt || "2099-01-01T00:00:00Z", data: { fields: { postalCode: value, state: value === "01001000" ? "SP" : "RJ", city: value === "01001000" ? "São Paulo" : "Rio de Janeiro", municipalityCode: value === "01001000" ? "3550308" : "3304557" } } }))
      return
    }
    expect(input.kind).toBe("cnpj"); expect(input.context).toBe("party")
    const value = input.value.replace(/[.\s/-]/g, "").toUpperCase()
    requests.push(value)
    const result = source(value)
    if (gate && heldDocument === value) await gate
    response.writeHead(sourceStatus)
    response.end(JSON.stringify(sourceStatus === 200 ? result : { title: "Fonte indisponível. Continue manualmente." })); return
  }
  if (request.url?.startsWith("/api/v1/parties")) {
    if (request.method === "POST" || request.method === "PUT") {
      let raw = ""; for await (const chunk of request) raw += chunk
      if (request.method === "PUT") expect(request.headers["if-match"]).toBe(`"${party.revision}"`)
      else expect(request.headers["idempotency-key"]).toBeTruthy()
      party = { ...JSON.parse(raw), id: record, revision: party.revision + 1 }
      writes++
      response.writeHead(request.method === "POST" ? 201 : 200, { ETag: `"${party.revision}"` })
    } else response.setHeader("ETag", `"${party.revision}"`)
    response.end(JSON.stringify({ tenantId: tenant, canEdit, data: request.url.includes("?") ? [] : party, total: 0 })); return
  }
  response.writeHead(404); response.end("{}")
})

test.beforeAll(async () => { await new Promise<void>(resolve => upstream.listen(33941, "127.0.0.1", resolve)) })
test.afterAll(async () => { await new Promise<void>(resolve => upstream.close(() => resolve())) })
test.beforeEach(async ({ context }) => {
  party = initial(); canEdit = true; sourceStatus = 200; replyTenant = tenant; sessionTenant = tenant; expiresAt = null; requests = []; writes = 0; gate = null; heldDocument = ""
  await installFrontendFixture(context)
  await context.route("**/api/erp/**", route => route.continue())
})
const cnpjInput = (page: Page) => page.getByRole("textbox", { name: "CPF ou CNPJ", exact: true })
const fantasy = (page: Page) => page.getByRole("textbox", { name: "Nome fantasia", exact: true })

test("CNPJ recuperado mantém a origem do endereço após completar IBGE", async ({ page }) => {
  let cepCalls = 0
  await page.route("**/api/erp/registry-lookups", route => {
    if (route.request().postDataJSON().kind === "cep" && ++cepCalls === 1) return route.fulfill({ status: 503, json: { title: "Consulta temporariamente indisponível" } })
    return route.continue()
  })
  await page.goto(`${path}/novo`)
  await cnpjInput(page).fill(first)
  await expect(page.getByLabel("Endereço 1: Número", { exact: true })).toHaveValue("04")
  await expect.poll(() => cepCalls).toBe(1)
  page.once("dialog", dialog => dialog.accept())
  await page.reload()
  await expect(page.getByLabel("Endereço 1: Código IBGE", { exact: true })).toHaveValue("3550308")
  await cnpjInput(page).fill(second)
  await expect(page.getByLabel("Endereço 1: Número", { exact: true })).toHaveValue("19")
})

for (const role of ["customer", "supplier"]) test(`automatic CNPJ fills and persists ${role} contacts and address through the real BFF`, async ({ page }) => {
  await page.setViewportSize({ width: role === "customer" ? 320 : 1280, height: 900 })
  await page.goto(`${path}/novo`)
  if (role === "supplier") {
    await page.getByRole("checkbox", { name: "Fornecedor", exact: true }).check()
    await page.getByRole("checkbox", { name: "Cliente", exact: true }).uncheck()
  }
  await cnpjInput(page).fill("04.252.011/0001-10")
  await expect(fantasy(page)).toHaveValue("Fantasia 04")
  await expect(page.getByRole("textbox", { name: "E-mail", exact: true })).toHaveValue("contato@example.test")
  await expect(page.getByRole("textbox", { name: "Telefone", exact: true })).toHaveValue("1133334444")
  await expect(page.getByLabel("Endereço 1: Rua", { exact: true })).toHaveValue("Rua cadastral")
  await expect(page.getByLabel("Endereço 1: Principal", { exact: true })).not.toBeChecked()
  expect(writes).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole("button", { name: "Salvar pessoa", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${path}/${record}$`), { timeout: process.env.ERP_BROWSER_DEV === "1" ? 30_000 : 5_000 })
  await expect(page.getByRole("heading", { name: "Empresa da fonte", exact: true })).toBeVisible()
  expect(party.email).toBe("contato@example.test")
  expect(party.phone).toBe("1133334444")
  expect(party.addresses).toHaveLength(1)
  expect(party.addresses[0]).toMatchObject({ postalCode: "01001000", state: "SP", city: "São Paulo", street: "Rua cadastral", number: "04", district: "Centro", complement: "Sala 2" })
  expect(party.isSupplier).toBe(role === "supplier")
  expect(party.isCustomer).toBe(role === "customer")
  await page.reload()
  await expect(page.getByText("contato@example.test", { exact: true })).toBeVisible()
  await expect(page.getByText("Rua cadastral, 04 · Centro", { exact: true })).toBeVisible()
  expect(writes).toBe(1)
})

test("manual contacts and an existing delivery address survive the automatic lookup", async ({ page }) => {
  party.email = "manual@example.test"; party.phone = "11988887777"
  party.addresses = [{ label: "Entrega", postalCode: "20040002", state: "RJ", city: "Rio de Janeiro", street: "Rua manual", number: "7", district: "Centro", complement: null, primary: true }]
  await page.goto(`${path}/${record}/editar`)
  await cnpjInput(page).fill(first)
  await expect(fantasy(page)).toHaveValue("Fantasia 04")
  await expect(page.getByRole("textbox", { name: "Nome ou razão social", exact: true })).toHaveValue("Nome editado")
  await expect(page.getByRole("textbox", { name: "E-mail", exact: true })).toHaveValue("manual@example.test")
  await expect(page.getByRole("textbox", { name: "Telefone", exact: true })).toHaveValue("11988887777")
  await expect(page.getByLabel("Endereço 1: Rua", { exact: true })).toHaveValue("Rua manual")
  await expect(page.getByLabel("Endereço 2: Rua", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Salvar pessoa", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Pessoa salva no servidor" })).toBeVisible()
  await page.getByRole("button", { name: "Consultar CNPJ", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Nenhum campo vazio" })).toBeVisible()
  await expect(page.getByRole("status").filter({ hasText: "Pessoa salva no servidor" })).toBeVisible()
  expect(writes).toBe(1)
  expect(party.email).toBe("manual@example.test")
  expect(party.addresses[0].street).toBe("Rua manual")
})

test("manual edits made while the CNPJ source is pending are preserved", async ({ page }) => {
  let release!: () => void
  gate = new Promise<void>(resolve => { release = resolve }); heldDocument = first
  await page.goto(`${path}/novo`)
  await cnpjInput(page).fill(first)
  await expect.poll(() => requests.length).toBe(1)
  try {
    await page.getByRole("textbox", { name: "Nome ou razão social", exact: true }).fill("Nome digitado durante a consulta")
    await page.getByRole("textbox", { name: "E-mail", exact: true }).fill("durante@example.test")
    await page.getByRole("button", { name: "Adicionar endereço", exact: true }).click()
    await page.getByLabel("Endereço 1: Rua", { exact: true }).fill("Minha entrega")
  } finally { release() }
  await expect(fantasy(page)).toHaveValue("Fantasia 04")
  await expect(page.getByRole("textbox", { name: "Nome ou razão social", exact: true })).toHaveValue("Nome digitado durante a consulta")
  await expect(page.getByRole("textbox", { name: "E-mail", exact: true })).toHaveValue("durante@example.test")
  await expect(page.getByLabel("Endereço 1: Rua", { exact: true })).toHaveValue("Minha entrega")
})

test("changing CNPJ replaces untouched generated values and keeps subsequent manual edits", async ({ page }) => {
  await page.goto(`${path}/novo`)
  await cnpjInput(page).fill(first)
  await expect(fantasy(page)).toHaveValue("Fantasia 04")
  await expect(page.getByLabel("Endereço 1: Código IBGE", { exact: true })).toHaveValue("3550308")
  await page.getByRole("textbox", { name: "Nome ou razão social", exact: true }).fill("Minha edição")
  await page.getByRole("textbox", { name: "E-mail", exact: true }).fill("escolhido@example.test")
  await cnpjInput(page).fill(second)
  await expect(fantasy(page)).toHaveValue("Fantasia 19")
  await expect(page.getByRole("textbox", { name: "Nome ou razão social", exact: true })).toHaveValue("Minha edição")
  await expect(page.getByRole("textbox", { name: "E-mail", exact: true })).toHaveValue("escolhido@example.test")
  await expect(page.getByLabel("Endereço 1: Número", { exact: true })).toHaveValue("19")
  await expect(page.getByLabel("Endereço 2: Rua", { exact: true })).toHaveCount(0)
  await page.getByLabel("Endereço 1: Rua", { exact: true }).fill("Endereço corrigido")
  await cnpjInput(page).fill(first)
  await expect(fantasy(page)).toHaveValue("Fantasia 04")
  await expect(page.getByLabel("Endereço 1: Rua", { exact: true })).toHaveValue("Endereço corrigido")
})

test("late responses never fill the next CNPJ", async ({ page }) => {
  let release!: () => void
  gate = new Promise<void>(resolve => { release = resolve }); heldDocument = first
  await page.goto(`${path}/novo`)
  await cnpjInput(page).fill(first)
  await expect.poll(() => requests.length).toBe(1)
  try {
    await cnpjInput(page).fill(second)
    await expect(fantasy(page)).toHaveValue("Fantasia 19")
  } finally { release() }
  await expect(fantasy(page)).toHaveValue("Fantasia 19")
  await expect(page.getByLabel("Endereço 1: Número", { exact: true })).toHaveValue("19")
})

test("session confirmation rechecks the document after waiting", async ({ page }) => {
  let release!: () => void
  let started!: () => void
  const waiting = new Promise<void>(resolve => { started = resolve })
  const confirmation = new Promise<void>(resolve => { release = resolve })
  await page.route("**/api/erp/me", async route => {
    if (requests.length) { started(); await confirmation }
    await route.continue().catch(() => undefined)
  })
  await page.goto(`${path}/novo`)
  await cnpjInput(page).fill(first)
  await waiting
  try { await cnpjInput(page).fill("52998224725") } finally { release() }
  await expect(fantasy(page)).toHaveValue("")
  await expect(page.getByLabel("Endereço 1: Rua", { exact: true })).toHaveCount(0)
})

test("a company switched in another tab blocks automatic filling from the old tenant", async ({ page, context }) => {
  let release!: () => void
  gate = new Promise<void>(resolve => { release = resolve }); heldDocument = first
  await page.goto(`${path}/novo`)
  await cnpjInput(page).fill(first)
  await expect.poll(() => requests.length).toBe(1)
  try {
    await installFrontendFixture(context, origin, record)
    await context.route("**/api/erp/**", route => route.continue())
  } finally { release() }
  await expect(page.getByRole("status").filter({ hasText: "empresa da sessão mudou" })).toBeVisible()
  await expect(fantasy(page)).toHaveValue("")
  await expect(page.getByLabel("Endereço 1: Rua", { exact: true })).toHaveCount(0)
})

for (const failure of ["reply-tenant", "session-tenant", "expired"]) test(`${failure} prevents automatic application`, async ({ page }) => {
  if (failure === "reply-tenant") replyTenant = record
  if (failure === "session-tenant") sessionTenant = record
  if (failure === "expired") expiresAt = "2000-01-01T00:00:00Z"
  await page.goto(`${path}/novo`)
  await cnpjInput(page).fill(first)
  await expect.poll(() => requests.length).toBe(1)
  await expect(page.getByRole("status").filter({ hasText: failure === "expired" ? "venceu" : "mudou" })).toBeVisible()
  await expect(fantasy(page)).toHaveValue("")
  await expect(page.getByLabel("Endereço 1: Rua", { exact: true })).toHaveCount(0)
  expect(writes).toBe(0)
})

test("CPF and invalid CNPJ stay manual and provider failure supports retry", async ({ page }) => {
  await page.goto(`${path}/novo`)
  for (const value of ["52998224725", "04252011000111"]) {
    await cnpjInput(page).fill(value)
    await page.waitForTimeout(750)
    expect(requests).toHaveLength(0)
  }
  sourceStatus = 503
  await cnpjInput(page).fill(first)
  await expect(page.getByRole("alert").filter({ hasText: "Fonte indisponível" })).toBeVisible()
  await page.getByRole("textbox", { name: "Nome ou razão social", exact: true }).fill("Cadastro manual")
  sourceStatus = 200
  await page.getByRole("button", { name: "Consultar CNPJ", exact: true }).click()
  await expect(fantasy(page)).toHaveValue("Fantasia 04")
  await expect(page.getByRole("textbox", { name: "Nome ou razão social", exact: true })).toHaveValue("Cadastro manual")
})

test("read-only records never start automatic CNPJ queries", async ({ page }) => {
  canEdit = false; party.taxId = first
  await page.goto(`${path}/${record}/editar`)
  await expect(page.getByRole("button", { name: "Consultar CNPJ", exact: true })).toBeDisabled()
  await page.waitForTimeout(750)
  expect(requests).toHaveLength(0)
  await expect(page.getByRole("button", { name: "Salvar pessoa", exact: true })).toBeDisabled()
})
