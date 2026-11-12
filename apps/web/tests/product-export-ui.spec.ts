import { expect, test, type Page } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { installFrontendFixture, tenant } from "./helpers/frontend-fixture"

const header = "sku,name,unit,ncm,cest,base_price,status\r\n"
const csv = header + 'LD-A1,"Árvore, ""academia""",UN,01010101,0012345,19419.84,active\r\nLD-A2,\'=SUM(A1:A2),UN,,,10.00,archived\r\n'
const endpoint = /\/api\/erp\/products\/export(?:\?|$)/
async function fixture(page: Page, permissions = ["catalog.products.export", "catalog.products.read"]) {
  const queries: URLSearchParams[] = []
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions } }))
  await page.route(endpoint, route => { queries.push(new URL(route.request().url()).searchParams); return route.fulfill({ body: csv, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=produtos.csv" } }) })
  return queries
}

for (const width of [320, 390, 430, 1366, 1440]) test(`exporta o CSV e preserva conteúdo e filtros em ${width}px`, async ({ context, page, baseURL }, info) => {
  await installFrontendFixture(context, baseURL)
  const queries = await fixture(page)
  await page.setViewportSize({ width, height: 900 })
  await page.goto("/preferencias/dados/exportacao")
  await page.getByLabel("Buscar por SKU ou nome", { exact: true }).fill("  Academia  ")
  await page.getByRole("combobox", { name: "Situação", exact: true }).selectOption("active")
  const [download] = await Promise.all([page.waitForEvent("download"), width === 390 ? page.getByLabel("Buscar por SKU ou nome", { exact: true }).press("Enter") : page.getByRole("button", { name: "Baixar produtos.csv", exact: true }).click()])
  expect(download.suggestedFilename()).toBe("produtos.csv")
  expect(await readFile((await download.path())!, "utf8")).toBe(csv)
  expect(queries.at(-1)?.get("q")).toBe("Academia")
  expect(queries.at(-1)?.get("status")).toBe("active")
  await expect(page.getByRole("status").filter({ hasText: "CSV enviado ao navegador" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Conferir produtos no catálogo", exact: true })).toHaveAttribute("href", "/cadastros/produtos?q=Academia&status=active")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  if (width < 500) expect((await page.getByRole("button", { name: "Baixar produtos.csv", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.screenshot({ path: info.outputPath(`product-export-${width}.png`), fullPage: true })
})

test("geração congela os filtros que serão usados no arquivo", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  await fixture(page)
  let release!: () => void
  const ready = new Promise<void>(resolve => { release = resolve })
  let requests = 0
  await page.route(endpoint, async route => { requests++; await ready; await route.fulfill({ body: csv, contentType: "text/csv" }).catch(() => {}) })
  await page.goto("/preferencias/dados/exportacao")
  const search = page.getByLabel("Buscar por SKU ou nome", { exact: true })
  await search.fill("Academia")
  await page.getByRole("button", { name: "Baixar produtos.csv", exact: true }).click()
  try {
    await expect.poll(() => requests).toBe(1)
    await expect(search).toBeDisabled()
    await expect(page.getByRole("combobox", { name: "Situação", exact: true })).toBeDisabled()
    await expect(page.getByRole("button", { name: "Cancelar download", exact: true })).toBeVisible()
  } finally { release() }
})

test("resposta JSON com HTTP200 não vira um arquivo CSV", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  await fixture(page)
  await page.route(endpoint, route => route.fulfill({ json: { data: [] } }))
  let downloads = 0
  page.on("download", () => downloads++)
  await page.goto("/preferencias/dados/exportacao")
  await page.getByRole("button", { name: "Baixar produtos.csv", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "CSV" })).toBeVisible()
  expect(downloads).toBe(0)
})

test("permissão é conferida antes de iniciar a exportação e pode ser atualizada", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  const queries = await fixture(page, ["catalog.products.read"])
  let allowed = false
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["catalog.products.read", ...(allowed ? ["catalog.products.export"] : [])] } }))
  await page.goto("/preferencias/dados/exportacao")
  await expect(page.getByRole("button", { name: "Baixar produtos.csv", exact: true })).toBeDisabled()
  await expect(page.getByText("Seu acesso não permite exportar produtos. Solicite a permissão à gestão.", { exact: true })).toBeVisible()
  expect(queries).toHaveLength(0)
  await page.getByLabel("Buscar por SKU ou nome", { exact: true }).fill("Academia")
  allowed = true
  await page.getByRole("button", { name: "Conferir acesso", exact: true }).click()
  await expect(page.getByRole("button", { name: "Baixar produtos.csv", exact: true })).toBeEnabled()
  await expect(page.getByLabel("Buscar por SKU ou nome", { exact: true })).toHaveValue("Academia")
})

test("erro e repetição preservam filtros e um CSV de cabeçalhos é um resultado vazio válido", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  const queries = await fixture(page)
  let attempts = 0
  await page.route(endpoint, route => { attempts++; queries.push(new URL(route.request().url()).searchParams); return route.fulfill(attempts === 1 ? { status: 503, json: { title: "CSV temporariamente indisponível" } } : { body: header, contentType: "text/csv" }) })
  await page.goto("/preferencias/dados/exportacao")
  await page.getByLabel("Buscar por SKU ou nome", { exact: true }).fill("ausente")
  await page.getByRole("combobox", { name: "Situação", exact: true }).selectOption("archived")
  await page.getByRole("button", { name: "Baixar produtos.csv", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "CSV temporariamente indisponível" })).toBeVisible()
  await expect(page.getByLabel("Buscar por SKU ou nome", { exact: true })).toHaveValue("ausente")
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Baixar produtos.csv", exact: true }).click()])
  expect(await readFile((await download.path())!, "utf8")).toBe(header)
  await expect(page.getByRole("status").filter({ hasText: "Nenhum produto corresponde aos filtros" })).toBeVisible()
  expect(queries.map(query => [query.get("q"), query.get("status")])).toEqual([["ausente", "archived"], ["ausente", "archived"]])
})

test("cancelamento libera os filtros e impede entrega tardia", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  await fixture(page)
  let release!: () => void
  const ready = new Promise<void>(resolve => { release = resolve })
  let requests = 0
  let downloads = 0
  page.on("download", () => downloads++)
  await page.route(endpoint, async route => { requests++; if (requests === 1) await ready; await route.fulfill({ body: csv, contentType: "text/csv" }).catch(() => {}) })
  await page.goto("/preferencias/dados/exportacao")
  await page.getByLabel("Buscar por SKU ou nome", { exact: true }).fill("Academia")
  await page.getByRole("button", { name: "Baixar produtos.csv", exact: true }).click()
  try {
    await expect.poll(() => requests).toBe(1)
    await page.getByRole("button", { name: "Cancelar download", exact: true }).click()
    await expect(page.getByRole("status").filter({ hasText: "Download cancelado" })).toBeVisible()
    await expect(page.getByLabel("Buscar por SKU ou nome", { exact: true })).toBeEnabled()
    expect(downloads).toBe(0)
  } finally { release() }
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Baixar produtos.csv", exact: true }).click()])
  expect(await download.failure()).toBeNull()
  expect(downloads).toBe(1)
})

test("saída durante geração pede confirmação e aceitar impede download depois da saída", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  await fixture(page)
  let release!: () => void
  const ready = new Promise<void>(resolve => { release = resolve })
  let downloads = 0
  page.on("download", () => downloads++)
  await page.route(endpoint, async route => { await ready; await route.fulfill({ body: csv, contentType: "text/csv" }).catch(() => {}) })
  await page.goto("/preferencias/dados/exportacao")
  await page.getByRole("button", { name: "Baixar produtos.csv", exact: true }).click()
  let allow = false
  let dialogs = 0
  page.on("dialog", dialog => { dialogs++; void (allow ? dialog.accept() : dialog.dismiss()) })
  try {
    await page.getByRole("link", { name: "Voltar às preferências", exact: true }).click()
    await expect.poll(() => dialogs).toBe(1)
    await expect(page.getByRole("button", { name: "Cancelar download", exact: true })).toBeVisible()
    allow = true
    await page.getByRole("link", { name: "Voltar às preferências", exact: true }).click()
    await expect(page).toHaveURL(/\/preferencias\?categoria=exportacao$/)
  } finally { release() }
  expect(downloads).toBe(0)
})

test("falha ao conferir acesso permite repetir sem iniciar exportação", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  const queries = await fixture(page)
  let available = false
  await page.route("**/api/erp/me", route => route.fulfill(!available ? { status: 503, json: { title: "Consulta de acesso indisponível" } } : { json: { tenant: { id: tenant }, permissions: ["catalog.products.export"] } }))
  await page.goto("/preferencias/dados/exportacao")
  await expect(page.getByRole("alert").filter({ hasText: "Consulta de acesso indisponível" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Baixar produtos.csv", exact: true })).toBeDisabled()
  expect(queries).toHaveLength(0)
  await page.getByLabel("Buscar por SKU ou nome", { exact: true }).fill("Academia")
  available = true
  await page.getByRole("button", { name: "Conferir acesso", exact: true }).click()
  await expect(page.getByRole("button", { name: "Baixar produtos.csv", exact: true })).toBeEnabled()
  await expect(page.getByRole("link", { name: "Conferir produtos no catálogo", exact: true })).toHaveCount(0)
  await expect(page.getByLabel("Buscar por SKU ou nome", { exact: true })).toHaveValue("Academia")
})

test("recusa do backend não gera arquivo e permite conferir a permissão atual", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  await fixture(page)
  let allowed = true
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: allowed ? ["catalog.products.export"] : [] } }))
  await page.route(endpoint, route => route.fulfill({ status: 403, json: { title: "Sem permissão para exportar produtos" } }))
  let downloads = 0
  page.on("download", () => downloads++)
  await page.goto("/preferencias/dados/exportacao")
  await page.getByLabel("Buscar por SKU ou nome", { exact: true }).fill("Academia")
  await page.getByRole("button", { name: "Baixar produtos.csv", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Sem permissão para exportar produtos" })).toBeVisible()
  expect(downloads).toBe(0)
  allowed = false
  await page.getByRole("button", { name: "Conferir acesso", exact: true }).click()
  await expect(page.getByRole("button", { name: "Baixar produtos.csv", exact: true })).toBeDisabled()
  await expect(page.getByLabel("Buscar por SKU ou nome", { exact: true })).toHaveValue("Academia")
})
