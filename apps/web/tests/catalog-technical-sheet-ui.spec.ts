import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { origin, secret } from "../playwright.danfe.config"

const tenant = "11111111-1111-4111-8111-111111111111"
const id = "22222222-2222-4222-8222-222222222222"
const product = { id, sku: "TEST-001", name: "Equipamento de teste", unit: "UN", basePrice: "12.50", ncm: null, cest: null, status: "active", revision: 1, hasPhoto: false, plateHolderTypes: [] }
const sample = { revision: 1, collection: "premium", muscleGroup: "Abdômen", technicalCategory: "Bateria de pesos", dimensionsMm: [1200, 900, 1800], description: "Descrição técnica original do equipamento.", weight: "280 kg", weightStack: "95 kg", publicPath: `/loja/product-${id}/`, mainMediaId: null, manufacturer: "Fabricante de teste", manufacturerModel: "MODEL-001", catalogProductName: "Original Equipment Name", liveArea: "3.1 × 2.8 m", catalogSources: [{ title: "Catálogo do fabricante", url: "https://example.test/catalog.pdf#page=6", pdfPage: 6, printedPage: 10 }] }

async function authenticate(context: BrowserContext) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "technical-sheet-fixture", tenantId: tenant, expiresAt: Date.now() + 3600_000 })), cipher.final()])
  await context.addCookies([{ name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" }])
}

async function fixture(page: Page, initial: typeof sample | null = null, canEdit = true, behavior: "save" | "conflict" | "uncertain" | "uncommitted" = "save") {
  let data = initial
  const writes: { body: Record<string, unknown>; revision?: string }[] = []
  const media: string[] = []
  page.on("request", request => { if (request.url().includes(`/products/${id}/media/`)) media.push(request.url()) })
  await page.route("**/api/erp/**", route => route.fulfill({ status: 503, json: { title: "Consulta não configurada na fixture" } }))
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant, legalName: "Empresa de teste" } } }))
  await page.route(`**/api/erp/products/${id}`, route => route.fulfill({ headers: { etag: '"1"' }, json: { tenantId: tenant, canEdit, data: product } }))
  await page.route(`**/api/erp/products/${id}/catalog`, async route => {
    if (route.request().method() === "GET") return route.fulfill({ headers: { etag: `"${data?.revision || 0}"` }, json: { tenantId: tenant, productId: id, canEdit, data, defaultCollection: "premium", mediaConfigured: false, assets: [] } })
    const body = route.request().postDataJSON()
    writes.push({ body, revision: route.request().headers()["if-match"] })
    if (behavior === "conflict") return route.fulfill({ status: 412, json: { title: "A ficha foi alterada por outra pessoa." } })
    if (behavior === "uncommitted" && writes.length === 1) return route.abort("failed")
    data = { ...body, revision: (data?.revision || 0) + 1, publicPath: sample.publicPath } as typeof sample
    if (behavior === "uncertain") return route.abort("failed")
    return route.fulfill({ headers: { etag: `"${data.revision}"` }, json: { saved: true, revision: data.revision, mainMediaId: null } })
  })
  return { writes, media }
}

test.beforeEach(async ({ context }) => { await authenticate(context) })

test("cria a ficha técnica de produto sem galeria e conserva dados após recarregar", async ({ page }) => {
  const state = await fixture(page)
  await page.goto(`/cadastros/produtos/${id}`)
  await page.getByRole("button", { name: "Adicionar ficha técnica", exact: true }).click({ timeout: 10000 })
  const form = page.getByRole("form", { name: "Ficha técnica do produto", exact: true })
  await form.getByRole("textbox", { name: "Fabricante", exact: true }).fill("Fabricante de teste")
  await form.getByRole("textbox", { name: "Modelo do fabricante", exact: true }).fill("MODEL-001")
  await form.getByRole("textbox", { name: "Nome no catálogo", exact: true }).fill("Original Equipment Name")
  await form.getByRole("textbox", { name: "Grupo corporal", exact: true }).fill("Abdômen")
  await form.getByRole("textbox", { name: "Categoria técnica", exact: true }).fill("Bateria de pesos")
  await form.getByRole("textbox", { name: "Peso do equipamento (kg)", exact: true }).fill("280 kg")
  await form.getByRole("textbox", { name: "Bateria de pesos", exact: true }).fill("95 kg")
  for (const [name, value] of [["Comprimento (mm)", "1200"], ["Largura (mm)", "900"], ["Altura (mm)", "1800"]]) await form.getByRole("spinbutton", { name, exact: true }).fill(value)
  await form.getByRole("textbox", { name: "Descrição", exact: true }).fill(sample.description)
  await form.getByRole("textbox", { name: "Área de treino publicada", exact: true }).fill(sample.liveArea)
  await form.getByRole("button", { name: "Adicionar fonte", exact: true }).click()
  await form.getByRole("textbox", { name: "Título da fonte 1", exact: true }).fill(sample.catalogSources[0].title)
  await form.getByRole("textbox", { name: "URL da fonte 1", exact: true }).fill(sample.catalogSources[0].url)
  await form.getByRole("spinbutton", { name: "Página PDF da fonte 1", exact: true }).fill("6")
  await form.getByRole("spinbutton", { name: "Página impressa da fonte 1", exact: true }).fill("10")
  await form.getByRole("button", { name: "Salvar ficha técnica", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Ficha técnica salva" })).toBeVisible()
  expect(state.writes).toHaveLength(1)
  expect(state.writes[0].revision).toBe('"0"')
  expect(state.writes[0].body.manufacturerModel).toBe("MODEL-001")
  expect(state.writes[0].body.mainMediaId).toBeNull()
  await page.reload()
  const section = page.getByRole("region", { name: "Ficha técnica", exact: true })
  await expect(section.getByText("MODEL-001", { exact: true })).toBeVisible()
  await expect(section.getByRole("link", { name: /Catálogo do fabricante/ })).toHaveAttribute("href", sample.catalogSources[0].url)
  expect(state.media).toHaveLength(0)
})

test("ficha técnica é compacta em celular e permite edição na tela de editar produto", async ({ page }, info) => {
  await fixture(page, sample)
  await page.goto(`/cadastros/produtos/${id}/editar`)
  const form = page.getByRole("form", { name: "Ficha técnica do produto", exact: true })
  await expect(form.getByRole("textbox", { name: "Modelo do fabricante", exact: true })).toHaveValue("MODEL-001")
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 852 })
    await expect(form.getByRole("button", { name: "Salvar ficha técnica", exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  }
  await page.setViewportSize({ width: 390, height: 852 })
  await page.screenshot({ path: info.outputPath("technical-sheet-mobile.png"), fullPage: true })
})

test("leitor consulta os dados técnicos e não recebe controles de edição", async ({ page }) => {
  await fixture(page, sample, false)
  await page.goto(`/cadastros/produtos/${id}`)
  const section = page.getByRole("region", { name: "Ficha técnica", exact: true })
  await expect(section.getByText("MODEL-001", { exact: true })).toBeVisible()
  await expect(section.getByRole("button", { name: "Editar ficha técnica", exact: true })).toHaveCount(0)
  await expect(section.locator("input,textarea,select")).toHaveCount(0)
})

test("conflito preserva a edição e pede confirmação antes de recarregar", async ({ page }) => {
  await fixture(page, sample, true, "conflict")
  await page.goto(`/cadastros/produtos/${id}/editar`)
  const form = page.getByRole("form", { name: "Ficha técnica do produto", exact: true })
  const field = form.getByRole("textbox", { name: "Modelo do fabricante", exact: true })
  await field.fill("MODELO-EDITADO")
  await form.getByRole("button", { name: "Salvar ficha técnica", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: /alterada/ })).toBeVisible()
  await expect(field).toHaveValue("MODELO-EDITADO")
  await expect(form.getByRole("button", { name: "Salvar ficha técnica", exact: true })).toBeDisabled()
  page.once("dialog", dialog => dialog.dismiss())
  await page.getByRole("button", { name: "Recarregar ficha", exact: true }).click()
  await expect(field).toHaveValue("MODELO-EDITADO")
})

test("resposta perdida confere a ficha salva sem repetir o PUT", async ({ page }) => {
  const state = await fixture(page, sample, true, "uncertain")
  await page.goto(`/cadastros/produtos/${id}/editar`)
  const form = page.getByRole("form", { name: "Ficha técnica do produto", exact: true })
  await form.getByRole("textbox", { name: "Modelo do fabricante", exact: true }).fill("MODELO-CONFERIDO")
  await form.getByRole("button", { name: "Salvar ficha técnica", exact: true }).click()
  await page.getByRole("button", { name: "Conferir gravação", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Ficha técnica salva" })).toBeVisible()
  expect(state.writes).toHaveLength(1)
})

test("cadastro permite disponibilizar Standard e Olímpico para o fechamento", async ({ page }) => {
  await fixture(page, sample)
  const writes: Record<string, unknown>[] = []
  await page.route(`**/api/erp/products/${id}`, async route => {
    if (route.request().method() === "GET") return route.fulfill({ headers: { etag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: product } })
    const body = route.request().postDataJSON()
    writes.push(body)
    return route.fulfill({ headers: { etag: '"2"' }, json: { tenantId: tenant, canEdit: true, data: { ...product, ...body, revision: 2 } } })
  })
  await page.goto(`/cadastros/produtos/${id}/editar`)
  await page.getByRole("checkbox", { name: "Standard", exact: true }).check({ timeout: 10000 })
  await page.getByRole("checkbox", { name: "Olímpico", exact: true }).check()
  await page.getByRole("button", { name: "Salvar produto", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Produto salvo no servidor" })).toBeVisible()
  expect(writes).toHaveLength(1)
  expect(writes[0].plateHolderTypes).toEqual(["Standard", "Olímpico"])
  await expect(page.getByText("Cores dos anilheiros", { exact: true })).toHaveCount(0)
})

test("falha antes da gravação permite reenviar a edição técnica preservada", async ({ page }) => {
  const state = await fixture(page, sample, true, "uncommitted")
  await page.goto(`/cadastros/produtos/${id}/editar`)
  const form = page.getByRole("form", { name: "Ficha técnica do produto", exact: true })
  const field = form.getByRole("textbox", { name: "Modelo do fabricante", exact: true })
  await field.fill("MODELO-PRESERVADO")
  await form.getByRole("button", { name: "Salvar ficha técnica", exact: true }).click()
  await page.getByRole("button", { name: "Conferir gravação", exact: true }).click()
  await expect(field).toHaveValue("MODELO-PRESERVADO")
  await expect(form.getByRole("button", { name: "Salvar ficha técnica", exact: true })).toBeEnabled()
  await form.getByRole("button", { name: "Salvar ficha técnica", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Ficha técnica salva" })).toBeVisible()
  expect(state.writes).toHaveLength(2)
  expect(state.writes.map(write => write.revision)).toEqual(['"1"', '"1"'])
})

test("salvar produto mantém a proteção do rascunho técnico ao navegar", async ({ page }) => {
  await fixture(page, sample)
  await page.route(`**/api/erp/products/${id}`, async route => {
    const saved = route.request().method() === "PUT"
    return route.fulfill({ headers: { etag: saved ? '"2"' : '"1"' }, json: { tenantId: tenant, canEdit: true, data: saved ? { ...product, ...route.request().postDataJSON(), revision: 2 } : product } })
  })
  await page.goto(`/cadastros/produtos/${id}/editar`)
  const field = page.getByRole("textbox", { name: "Modelo do fabricante", exact: true })
  await field.fill("RASCUNHO-TÉCNICO")
  await page.getByRole("textbox", { name: "Nome do produto", exact: true }).fill("Nome atualizado")
  await page.getByRole("button", { name: "Salvar produto", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Produto salvo no servidor" })).toBeVisible()
  let dialogs = 0
  page.on("dialog", async dialog => { dialogs += 1; await dialog.dismiss() })
  await page.getByRole("navigation", { name: "Caminho de navegação" }).getByRole("link", { name: "Produtos", exact: true }).click()
  await expect.poll(() => dialogs).toBe(1)
  await expect(field).toHaveValue("RASCUNHO-TÉCNICO")
  await expect(page).toHaveURL(new RegExp(`/produtos/${id}/editar$`))
})

test("recarregar produto mantém a edição técnica independente", async ({ page }) => {
  await fixture(page, sample)
  await page.goto(`/cadastros/produtos/${id}/editar`)
  const field = page.getByRole("textbox", { name: "Modelo do fabricante", exact: true })
  await field.fill("RASCUNHO-TÉCNICO")
  await page.getByRole("textbox", { name: "Nome do produto", exact: true }).fill("Descartar este nome")
  page.once("dialog", dialog => dialog.accept())
  await page.getByRole("button", { name: "Descartar rascunho", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Nome do produto", exact: true })).toHaveValue(product.name)
  await expect(field).toHaveValue("RASCUNHO-TÉCNICO")
})
