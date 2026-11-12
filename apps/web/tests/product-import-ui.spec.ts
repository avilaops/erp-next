import { expect, test, type Page } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { installFrontendFixture, tenant } from "./helpers/frontend-fixture"

const job = "22222222-2222-4222-8222-222222222222"
const csv = 'sku,name,unit,base_price\r\nA,"Árvore, academia",UN,19419.84\r\nB,Inválido,??,10.00\r\nC,Existente,UN,10.00\r\n'
const rowError = "Linha inválida: confira SKU, nome, unidade, preço, NCM e CEST"
const rows = [{ line: 2, input: { sku: "A", name: "Árvore, academia", unit: "UN", basePrice: "19419.84", status: "active" }, error: null, conflict: false }, { line: 3, input: { sku: "B", name: "Inválido", unit: "??", basePrice: "10.00", status: "active" }, error: rowError, conflict: false }, { line: 4, input: { sku: "C", name: "Existente", unit: "UN", basePrice: "10.00", status: "active" }, error: null, conflict: true }]
const preview = { id: job, filename: "academia.csv", format: "csv", status: "previewed", valid: 1, invalid: 1, conflicts: 1, rows, result: null }
const href = `/preferencias/dados/importacao?job=${job}`
async function fixture(page: Page) {
  const state = { imported: false, previews: 0, confirmations: 0, reads: 0, keys: [] as string[] }
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["catalog.products.import", "catalog.products.read"] } }))
  await page.route(/\/api\/erp\/products\/import(?:\/|$)/, route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === "POST" && request.headers()["x-tenant-id"] !== tenant) return route.fulfill({ status: 409, json: { title: "A empresa da sessão mudou. Sua edição foi preservada" } })
    if (path.endsWith("/confirm")) {
      state.confirmations++; state.keys.push(request.headers()["idempotency-key"])
      expect(request.postData()).toBeNull()
      state.imported = true
    } else if (request.method() === "POST") {
      state.previews++
      expect(request.postDataJSON()).toEqual({ filename: "academia.csv", content: csv })
    } else state.reads++
    return route.fulfill({ json: { data: state.imported ? { ...preview, status: "imported", result: { imported: 1, total: 3 } } : preview } })
  })
  return state
}
async function choose(page: Page) {
  await page.getByLabel("Arquivo CSV", { exact: true }).setInputFiles({ name: "academia.csv", mimeType: "text/csv", buffer: Buffer.from(csv) })
  const generate = page.getByRole("button", { name: "Gerar prévia", exact: true })
  await generate.click()
}

test("prévia envia a empresa ativa, sem confirmar produtos automaticamente", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  const state = await fixture(page)
  await page.goto("/preferencias/dados/importacao")
  await choose(page)
  await expect(page.getByText("Árvore, academia", { exact: true })).toBeVisible()
  expect(state.previews).toBe(1)
  expect(state.confirmations).toBe(0)
  await expect(page).toHaveURL(new RegExp(`job=${job}$`))
})

for (const width of [320, 390, 430, 1366, 1440]) test(`conferência explícita e resultado persistido em ${width}px`, async ({ context, page, baseURL }, info) => {
  await installFrontendFixture(context, baseURL)
  const state = await fixture(page)
  await page.setViewportSize({ width, height: 900 })
  await page.goto(href)
  await expect(page.getByText("Árvore, academia", { exact: true })).toBeVisible()
  await expect(page.getByText(rowError, { exact: true })).toBeVisible()
  await expect(page.getByText("SKU conflitante", { exact: true })).toBeVisible()
  const confirm = page.getByRole("button", { name: "Confirmar importação", exact: true })
  await expect(confirm).toBeDisabled()
  await page.reload()
  await page.getByRole("checkbox", { name: "Conferi a prévia e quero importar as linhas válidas." }).check()
  expect(state.confirmations).toBe(0)
  if (width < 500) expect((await confirm.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await confirm.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("status").filter({ hasText: "1 de 3 produto(s) importado(s)" })).toBeVisible()
  expect(state.keys).toEqual([job])
  await page.reload()
  await expect(page.getByRole("status").filter({ hasText: "1 de 3 produto(s) importado(s)" })).toBeVisible()
  await expect(confirm).toHaveCount(0)
  expect(state.confirmations).toBe(1)
  expect(state.previews).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`product-import-${width}.png`), fullPage: true })
})

test("perda da resposta consulta o mesmo resultado sem confirmar novamente", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  const state = await fixture(page)
  await page.route("**/api/erp/products/import/*/confirm", route => { state.imported = true; state.confirmations++; return route.abort("failed") })
  await page.goto(href)
  await page.getByRole("checkbox").check()
  await page.getByRole("button", { name: "Confirmar importação", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Ainda não foi possível confirmar o resultado" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Importar outro arquivo", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Conferir resultado", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "1 de 3 produto(s) importado(s)" })).toBeVisible()
  expect(state.confirmations).toBe(1)
})

test("repetição usa o mesmo job e a mesma chave após503", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  await fixture(page)
  const keys: string[] = []
  await page.route("**/api/erp/products/import/*/confirm", route => {
    keys.push(route.request().headers()["idempotency-key"])
    return keys.length === 1 ? route.fulfill({ status: 503, json: { title: "Resposta indisponível" } }) : route.fallback()
  })
  await page.goto(href)
  await page.getByRole("checkbox").check()
  await page.getByRole("button", { name: "Confirmar importação", exact: true }).click()
  await page.getByRole("button", { name: "Repetir confirmação", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "1 de 3 produto(s) importado(s)" })).toBeVisible()
  expect(keys).toEqual([job, job])
})

test("novo arquivo inválido não reutiliza a prévia anterior", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  const state = await fixture(page)
  await page.goto(href)
  await page.getByRole("link", { name: "Importar outro arquivo", exact: true }).click()
  await page.getByLabel("Arquivo CSV", { exact: true }).setInputFiles({ name: "x.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("x") })
  await page.getByRole("button", { name: "Gerar prévia", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "CSV" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Confirmar importação", exact: true })).toHaveCount(0)
  expect(state.confirmations).toBe(0)
  expect(state.previews).toBe(0)
  await choose(page)
  await expect(page).toHaveURL(new RegExp(`job=${job}$`))
})

test("acesso insuficiente impede selecionar e enviar CSV", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  const state = await fixture(page)
  let allowed = false
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: allowed ? ["catalog.products.import"] : [] } }))
  await page.goto("/preferencias/dados/importacao")
  await expect(page.getByText("Seu acesso não permite importar produtos. Solicite a permissão à gestão.", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Arquivo CSV", { exact: true })).toHaveCount(0)
  expect(state.previews).toBe(0)
  allowed = true
  await page.getByRole("button", { name: "Conferir acesso", exact: true }).click()
  await expect(page.getByLabel("Arquivo CSV", { exact: true })).toBeVisible()
})

test("resposta de outro job ou resultado incompleto não habilita confirmação", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  await fixture(page)
  let broken = true
  await page.route(`**/api/erp/products/import/${job}`, route => route.fulfill({ json: { data: broken ? { ...preview, id: "33333333-3333-4333-8333-333333333333" } : preview } }))
  await page.goto(href)
  await expect(page.getByRole("alert").filter({ hasText: "resultado de importação inválido" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Confirmar importação", exact: true })).toHaveCount(0)
  broken = false
  await page.getByRole("button", { name: "Conferir resultado", exact: true }).click()
  await expect(page.getByText("Árvore, academia", { exact: true })).toBeVisible()
})

test("sair durante confirmação pede confirmação e não aceita resposta tardia na outra tela", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  await fixture(page)
  let release!: () => void
  const ready = new Promise<void>(resolve => { release = resolve })
  let requests = 0
  await page.route("**/api/erp/products/import/*/confirm", async route => { requests++; await ready; await route.fulfill({ json: { data: { ...preview, status: "imported", result: { imported: 1, total: 3 } } } }).catch(() => {}) })
  await page.goto(href)
  await page.getByRole("checkbox").check()
  await page.getByRole("button", { name: "Confirmar importação", exact: true }).click()
  let allow = false
  let dialogs = 0
  page.on("dialog", dialog => { dialogs++; void (allow ? dialog.accept() : dialog.dismiss()) })
  try {
    await expect.poll(() => requests).toBe(1)
    await expect(page.getByRole("button", { name: "Confirmando…", exact: true })).toBeDisabled()
    await page.getByRole("link", { name: "Voltar às preferências", exact: true }).click()
    await expect.poll(() => dialogs).toBe(1)
    allow = true
    await page.getByRole("link", { name: "Voltar às preferências", exact: true }).click()
    await expect(page).toHaveURL(/\/preferencias\?categoria=importacao$/)
  } finally { release() }
  expect(requests).toBe(1)
})

test("orientação e modelo correspondem aos campos obrigatórios da API", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  await fixture(page)
  await page.goto("/preferencias/dados/importacao")
  await page.getByText("Formato do arquivo", { exact: true }).click()
  await expect(page.getByText(/Colunas obrigatórias: sku, name, unit e base_price/)).toBeVisible()
  await expect(page.getByText(/duas casas decimais.*19419.84/)).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Baixar modelo CSV", exact: true }).click()])
  expect((await readFile((await download.path())!, "utf8")).trim()).toBe("sku,name,unit,ncm,cest,base_price,status")
})

test("prévia ainda pendente não libera outro arquivo, inclusive após recarregar", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  const state = await fixture(page)
  await page.route("**/api/erp/products/import/*/confirm", route => { state.confirmations++; return route.abort("failed") })
  await page.goto(href)
  await page.getByRole("checkbox").check()
  await page.getByRole("button", { name: "Confirmar importação", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Ainda não foi possível confirmar o resultado" })).toBeVisible()
  await page.getByRole("button", { name: "Conferir resultado", exact: true }).click()
  await expect(page.getByRole("button", { name: "Conferir resultado", exact: true })).toBeEnabled()
  await expect(page.getByRole("link", { name: "Importar outro arquivo", exact: true })).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`job=${job}&pending=1$`))
  page.on("dialog", dialog => void dialog.accept())
  await page.reload()
  await expect(page.getByRole("status").filter({ hasText: "Ainda não foi possível confirmar o resultado" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Importar outro arquivo", exact: true })).toHaveCount(0)
  state.imported = true
  await page.getByRole("button", { name: "Conferir resultado", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "1 de 3 produto(s) importado(s)" })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`job=${job}$`))
  expect(state.confirmations).toBe(1)
})
