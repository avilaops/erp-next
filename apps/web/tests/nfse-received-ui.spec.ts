import { expect, test } from "@playwright/test"
import { createServer } from "node:http"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import path from "node:path"
import { installFrontendFixture, tenant } from "./helpers/frontend-fixture"
import { monitorOrigin as origin } from "../playwright.monitor.config"

const documentId = "22222222-2222-4222-8222-222222222222"
const otherTenant = "33333333-3333-4333-8333-333333333333"
const xml = readFileSync(path.resolve("../api/src/http/fixtures/nfse-national.xml"), "utf8")
const inspection = JSON.parse(readFileSync(path.resolve("../api/src/http/fixtures/nfse-national-inspection.json"), "utf8"))
delete inspection.xml
const document = { id: documentId, companyTaxId: "04252011000110", document: inspection, createdAt: "2026-11-03T10:00:00Z" }
const requests: { url: string; method: string; tenant?: string; command?: string; body?: { xml: string } }[] = []
let mode: "ready" | "empty" | "forbidden" | "wrong_tenant" = "ready"
let canImport = true
let imported = false
let corrupt = false
let uncertain = false
let paginated = false
let activeTenant = tenant
let hold: "list" | "detail" | null = null
let release: (() => void) | undefined

function releaseResponse() { release?.(); release = undefined }

const upstream = createServer(async (request, response) => {
  expect(request.headers.authorization).toBe("Bearer frontend-integration-fixture")
  let body = ""
  for await (const chunk of request) body += chunk
  requests.push({ url: request.url || "", method: request.method || "", tenant: request.headers["x-tenant-id"] as string, command: request.headers["idempotency-key"] as string, body: body ? JSON.parse(body) : undefined })
  response.setHeader("Content-Type", "application/json")
  if (mode === "forbidden") { response.statusCode = 403; return response.end(JSON.stringify({ title: "Sem permissão para consultar NFS-e" })) }
  const url = new URL(request.url || "/", origin)
  const tenantId = mode === "wrong_tenant" ? otherTenant : tenant
  if (url.pathname === "/api/v1/fiscal/received-nfses/import" && request.method === "POST") {
    if (uncertain) { uncertain = false; response.statusCode = 503; return response.end(JSON.stringify({ title: "Importação não confirmada. Atualize os arquivos antes de reenviar" })) }
    imported = true
    response.statusCode = 201
    return response.end(JSON.stringify({ tenantId, data: document }))
  }
  if (url.pathname === "/api/v1/fiscal/received-nfses") {
    if (hold === "list") { hold = null; await new Promise<void>(resolve => { release = resolve }) }
    const offset = Number(url.searchParams.get("offset") || 0)
    const data = mode === "empty" && !imported ? [] : paginated ? Array.from({ length: offset ? 1 : 25 }, (_, index) => ({ ...document, id: `${String(offset + index + 1).padStart(8, "0")}-2222-4222-8222-222222222222` })) : [document]
    return response.end(JSON.stringify({ tenantId, canImport, data, total: data.length ? paginated ? 26 : 1 : 0 }))
  }
  if (url.pathname === `/api/v1/fiscal/received-nfses/${documentId}`) {
    if (hold === "detail") { hold = null; await new Promise<void>(resolve => { release = resolve }) }
    return response.end(JSON.stringify({ tenantId, data: document }))
  }
  if (url.pathname === `/api/v1/fiscal/received-nfses/${documentId}/xml`) {
    response.setHeader("Content-Type", "application/xml; charset=utf-8")
    response.setHeader("X-Xml-Sha256", inspection.xmlSha256)
    return response.end(corrupt ? `${xml} ` : xml)
  }
  response.statusCode = 404
  response.end(JSON.stringify({ title: "Recurso não encontrado" }))
})

test.beforeAll(async () => { await new Promise<void>(resolve => upstream.listen(33929, "127.0.0.1", resolve)) })
test.afterAll(async () => { await new Promise<void>(resolve => upstream.close(() => resolve())) })
test.beforeEach(async ({ context, page }) => {
  mode = "ready"; canImport = true; imported = false; corrupt = false; uncertain = false; paginated = false; activeTenant = tenant; hold = null; release = undefined; requests.length = 0
  await installFrontendFixture(context, origin)
  await context.unroute("**/api/erp/**")
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: activeTenant, legalName: activeTenant === tenant ? "Empresa NFS-e sintética" : "Outra empresa sintética" }, permissions: ["fiscal.nfse.read", "fiscal.nfse.import"] } }))
})
test.afterEach(releaseResponse)

test("NFS-e BFF fixa tenant da sessão, exige origem e limita filtros e métodos", async ({ context, playwright }) => {
  const anonymous = await playwright.request.newContext({ baseURL: origin })
  const path = "/api/erp/fiscal/received-nfses"
  const headers = { "X-Tenant-Id": tenant }
  try { expect((await anonymous.get(path)).status()).toBe(401) }
  finally { await anonymous.dispose() }
  expect((await context.request.get(path)).status()).toBe(409)
  expect((await context.request.get(`${path}?offset=0&limit=25`, { headers })).status()).toBe(200)
  expect((await context.request.get(`${path}?limit=1&limit=2`, { headers })).status()).toBe(400)
  expect((await context.request.get(`${path}?environment=production`, { headers })).status()).toBe(400)
  expect((await context.request.get(`${path}/not-a-uuid`, { headers })).status()).toBe(400)
  expect((await context.request.get(`${path}/${documentId}`, { headers })).status()).toBe(200)
  expect((await context.request.get(`${path}/${documentId}/xml`, { headers })).status()).toBe(200)
  expect((await context.request.post(`${path}/import`, { headers: { ...headers, Origin: "https://outside.example" }, data: { xml } })).status()).toBe(403)
  expect((await context.request.post(`${path}/import`, { headers: { "X-Tenant-Id": otherTenant, Origin: origin }, data: { xml } })).status()).toBe(409)
  expect((await context.request.put(`${path}/${documentId}`, { headers, data: {} })).status()).toBe(405)
  expect(requests).toHaveLength(3)
})

test("central mostra origem e pendências, consulta atores distintos e baixa XML íntegro", async ({ page }) => {
  await page.goto("/fiscal/nfses")
  await expect(page.getByRole("heading", { name: "NFS-e recebidas", exact: true })).toBeVisible()
  await expect(page.locator("#conteudo-principal").getByText("Empresa NFS-e sintética", { exact: true })).toBeVisible()
  await expect(page.getByText("Assinatura e situação atual não verificadas", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Ver dados do serviço" }).click()
  await expect(page.getByText("Prestador sintético", { exact: true }).last()).toBeVisible()
  await expect(page.getByText("Tomador sintético", { exact: true })).toBeVisible()
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "Baixar XML original" }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(`NFSE-${inspection.accessKey}.xml`)
  expect(await readFile((await download.path())!)).toEqual(Buffer.from(xml))
  expect(requests.every(request => request.method === "GET" && request.tenant === tenant)).toBe(true)
})

test("importação envia arquivo original e comando único e recarrega os documentos", async ({ page }) => {
  mode = "empty"
  await page.goto("/fiscal/nfses")
  await expect(page.getByText("Nenhuma NFS-e importada nesta empresa.", { exact: true })).toBeVisible()
  await page.getByLabel("XML nacional de NFS-e", { exact: true }).setInputFiles({ name: "nfse.xml", mimeType: "application/xml", buffer: Buffer.from(xml) })
  await page.getByRole("button", { name: "Importar XML", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: /^XML nacional importado/ })).toBeVisible()
  const posts = requests.filter(request => request.method === "POST")
  expect(posts).toHaveLength(1)
  expect(posts[0].body).toEqual({ xml })
  expect(posts[0].command).toMatch(/^[a-f0-9-]{36}$/)
  expect(posts[0].tenant).toBe(tenant)
  await expect(page.getByRole("button", { name: "Baixar XML original" })).toBeEnabled()
})

test("resposta incerta limpa arquivos e preserva comando ao reenviar na mesma empresa", async ({ page }) => {
  uncertain = true
  await page.goto("/fiscal/nfses")
  await page.getByLabel("XML nacional de NFS-e", { exact: true }).setInputFiles({ name: "nfse.xml", mimeType: "application/xml", buffer: Buffer.from(xml) })
  await page.getByRole("button", { name: "Importar XML", exact: true }).click()
  const files = page.getByRole("region", { name: /^Arquivos armazenados/ })
  await expect(files.getByRole("alert")).toContainText("Importação não confirmada")
  await expect(page.getByRole("button", { name: "Baixar XML original" })).toHaveCount(0)
  await page.getByRole("button", { name: "Atualizar arquivos", exact: true }).click()
  await expect(page.getByRole("button", { name: "Importar XML", exact: true })).toBeEnabled()
  await page.getByRole("button", { name: "Importar XML", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: /^XML nacional importado/ })).toBeVisible()
  const posts = requests.filter(request => request.method === "POST")
  expect(posts).toHaveLength(2)
  expect(posts[0].command).toBe(posts[1].command)
})

test("leitura sem importação, recusa de acesso e resposta de outro tenant não deixam dados antigos", async ({ page }) => {
  canImport = false
  await page.goto("/fiscal/nfses")
  await expect(page.getByRole("button", { name: "Baixar XML original" })).toBeVisible()
  await expect(page.getByLabel("XML nacional de NFS-e", { exact: true })).toHaveCount(0)
  mode = "forbidden"
  await page.getByRole("button", { name: "Atualizar arquivos", exact: true }).click()
  const files = page.getByRole("region", { name: /^Arquivos armazenados/ })
  await expect(files.getByRole("alert")).toContainText("Sem permissão")
  await expect(page.getByRole("main").getByText("Empresa NFS-e sintética", { exact: true })).toHaveCount(0)
  mode = "wrong_tenant"
  await page.getByRole("button", { name: "Atualizar arquivos", exact: true }).click()
  await expect(files.getByRole("alert")).toContainText("empresa")
  await expect(page.getByRole("button", { name: "Baixar XML original" })).toHaveCount(0)
})

test("hash divergente e troca real da sessão impedem download", async ({ page, context }) => {
  await page.goto("/fiscal/nfses")
  corrupt = true
  await page.getByRole("button", { name: "Baixar XML original" }).click()
  const files = page.getByRole("region", { name: /^Arquivos armazenados/ })
  await expect(files.getByRole("alert")).toContainText("XML não corresponde")
  corrupt = false
  await page.getByRole("button", { name: "Atualizar arquivos", exact: true }).click()
  await expect(page.getByRole("button", { name: "Baixar XML original" })).toBeEnabled()
  const before = requests.length
  await installFrontendFixture(context, origin, otherTenant)
  await context.unroute("**/api/erp/**")
  await page.getByRole("button", { name: "Baixar XML original" }).click()
  await expect(files.getByRole("alert")).toContainText("empresa da sessão mudou")
  expect(requests).toHaveLength(before)
})

test("arquivo acima do limite ou sem UTF-8 válido não é enviado", async ({ page }) => {
  await page.goto("/fiscal/nfses")
  const files = page.getByRole("region", { name: /^Arquivos armazenados/ })
  for (const buffer of [Buffer.alloc(1_048_577, 120), Buffer.from([0xc3, 0x28])]) {
    await page.getByLabel("XML nacional de NFS-e", { exact: true }).setInputFiles({ name: "invalido.xml", mimeType: "application/xml", buffer })
    await expect(files.getByRole("alert")).toBeVisible()
    await expect(page.getByRole("button", { name: "Importar XML", exact: true })).toBeDisabled()
  }
  expect(requests.filter(request => request.method === "POST")).toHaveLength(0)
})

test("troca da sessão durante lista e detalhe impede publicar a resposta antiga", async ({ page, context }) => {
  for (const resource of ["list", "detail"] as const) {
    activeTenant = tenant
    await installFrontendFixture(context, origin)
    await context.unroute("**/api/erp/**")
    release = undefined
    hold = resource === "list" ? "list" : null
    await page.goto("/fiscal/nfses")
    if (resource === "detail") {
      await expect(page.getByRole("button", { name: "Ver dados do serviço" })).toBeEnabled()
      hold = "detail"
      await page.getByRole("button", { name: "Ver dados do serviço" }).click()
    }
    await expect.poll(() => typeof release).toBe("function")
    activeTenant = otherTenant
    await installFrontendFixture(context, origin, otherTenant)
    await context.unroute("**/api/erp/**")
    releaseResponse()
    const files = page.getByRole("region", { name: /^Arquivos armazenados/ })
    await expect(files.getByRole("alert")).toContainText("empresa da sessão mudou")
    await expect(page.getByRole("button", { name: "Baixar XML original" })).toHaveCount(0)
    await expect(page.getByRole("main").getByText("Empresa NFS-e sintética", { exact: true })).toHaveCount(0)
  }
})

test("troca observada de empresa invalida seleção mesmo se a nova lista for recusada", async ({ page, context }) => {
  await page.goto("/fiscal/nfses")
  await page.getByLabel("XML nacional de NFS-e", { exact: true }).setInputFiles({ name: "nfse.xml", mimeType: "application/xml", buffer: Buffer.from(xml) })
  await expect(page.getByRole("button", { name: "Importar XML", exact: true })).toBeEnabled()
  activeTenant = otherTenant; mode = "forbidden"
  await installFrontendFixture(context, origin, otherTenant)
  await context.unroute("**/api/erp/**")
  await page.getByRole("button", { name: "Atualizar arquivos", exact: true }).click()
  await expect(page.getByRole("region", { name: /^Arquivos armazenados/ }).getByRole("alert")).toContainText("Sem permissão")
  activeTenant = tenant; mode = "ready"
  await installFrontendFixture(context, origin)
  await context.unroute("**/api/erp/**")
  await page.getByRole("button", { name: "Atualizar arquivos", exact: true }).click()
  await expect(page.getByRole("button", { name: "Importar XML", exact: true })).toBeDisabled()
  await expect(page.getByText("Arquivo selecionado: nfse.xml", { exact: true })).toHaveCount(0)
})

test("paginação e cinco tamanhos preservam ações e arquivos sem corte horizontal", async ({ page }, testInfo) => {
  paginated = true
  for (const [width, height] of [[320, 740], [390, 844], [768, 1024], [1280, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height })
    await page.goto("/fiscal/nfses")
    await expect(page.getByRole("button", { name: "Baixar XML original" })).toHaveCount(25)
    expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`nfse-${width}.png`), fullPage: true })
  }
  await page.getByRole("button", { name: "Próximos arquivos", exact: true }).click()
  await expect(page.getByRole("button", { name: "Baixar XML original" })).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Arquivos anteriores", exact: true })).toBeEnabled()
  expect(createHash("sha256").update(xml).digest("hex")).toBe(inspection.xmlSha256)
})
