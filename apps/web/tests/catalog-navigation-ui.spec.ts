import { expect, test, type BrowserContext } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { origin, secret } from "../playwright.danfe.config"

const tenant = "11111111-1111-4111-8111-111111111111"
const productId = "22222222-2222-4222-8222-222222222222"
const product = { id: productId, name: "Produto de teste", sku: "TEST-001", unit: "UN", ncm: null, cest: null, basePrice: "12.50", status: "active", revision: 1 }

async function authenticate(context: BrowserContext, tenantId = tenant, token = "catalog-navigation-fixture") {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: token, tenantId, expiresAt: Date.now() + 3600_000 })), cipher.final()])
  await context.addCookies([{ name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" }])
}

test.beforeEach(async ({ context, page }) => {
  await authenticate(context)
  await page.route("**/api/erp/products**", route => {
    if (route.request().method() !== "GET") return route.fulfill({ status: 500, json: { title: "Gravação não configurada nesta fixture" } })
    const detail = new URL(route.request().url()).pathname.endsWith(productId)
    return route.fulfill({ json: { tenantId: tenant, canEdit: true, data: detail ? product : Array.from({ length: 25 }, (_, index) => ({ ...product, id: `${productId.slice(0, -2)}${String(index).padStart(2, "0")}`, name: `Produto de teste ${index + 1}` })), total: 50 }, headers: { etag: '"revision-1"' } })
  })
})

test("ações finais do catálogo ficam acima da navegação compacta", async ({ page }, testInfo) => {
  for (const width of [320, 390, 768, 1280, 1599]) {
    await page.setViewportSize({ width, height: 844 })
    for (const route of ["/cadastros/produtos", "/cadastros/produtos/novo"]) {
      await page.goto(route)
      const action = page.getByRole("button", { name: route.endsWith("novo") ? "Salvar produto" : "Próxima", exact: true })
      await expect(action).toBeEnabled({ timeout: 30_000 })
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
      const bar = await page.getByRole("navigation", { name: "Navegação móvel", exact: true }).boundingBox()
      const box = await action.boundingBox()
      expect(box!.y + box!.height, `${route} a ${width}px`).toBeLessThanOrEqual(bar!.y)
      await action.click({ trial: true })
      await action.focus()
      await expect(action).toBeFocused()
      if (width === 390) await page.screenshot({ path: testInfo.outputPath(route.endsWith("novo") ? "product-editor-mobile.png" : "products-mobile.png") })
    }
  }
})

test("Início pede confirmação e cancelar preserva a edição", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/cadastros/produtos/novo")
  const name = page.getByRole("textbox", { name: "Nome do produto", exact: true })
  await name.fill("Edição que deve continuar")
  let confirmations = 0
  page.on("dialog", async dialog => { confirmations++; await dialog.dismiss() })
  await page.getByRole("navigation", { name: "Navegação móvel", exact: true }).getByRole("link", { name: "Início", exact: true }).click()
  expect(confirmations).toBe(1)
  await expect(page).toHaveURL(/\/cadastros\/produtos\/novo$/)
  await expect(name).toHaveValue("Edição que deve continuar")
})

test("reabrir recupera o rascunho e descartar o remove", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/cadastros/produtos/novo")
  const name = page.getByRole("textbox", { name: "Nome do produto", exact: true })
  await name.fill("Rascunho recuperável")
  page.on("dialog", dialog => dialog.accept())
  await page.getByRole("navigation", { name: "Navegação móvel", exact: true }).getByRole("link", { name: "Início", exact: true }).click()
  await expect(page).toHaveURL(origin + "/")
  await page.goto("/cadastros/produtos/novo")
  await expect(name).toHaveValue("Rascunho recuperável")
  await expect(page.getByRole("status").filter({ hasText: "Rascunho recuperado" })).toBeVisible()
  await page.getByRole("button", { name: "Descartar rascunho", exact: true }).click()
  await expect(name).toHaveValue("")
  await page.reload()
  await expect(name).toHaveValue("")
})

test("menu desktop, módulos, busca e Voltar ao catálogo respeitam cancelamento", async ({ page }) => {
  await page.setViewportSize({ width: 1749, height: 950 })
  await page.goto("/cadastros/produtos/novo")
  const name = page.getByRole("textbox", { name: "Nome do produto", exact: true })
  await name.fill("Continuar editando")
  let confirmations = 0
  page.on("dialog", async dialog => { confirmations++; await dialog.dismiss() })
  const desktop = page.getByRole("navigation", { name: "Módulos do ERP", exact: true })
  await desktop.locator("summary").filter({ hasText: "Cadastros" }).click()
  await desktop.getByRole("link", { name: "Produtos", exact: true }).click()
  await page.getByRole("link", { name: "Voltar ao catálogo", exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "Módulos", exact: true }).click()
  await page.getByRole("dialog").getByRole("link", { name: "Produtos", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.keyboard.press("Escape")
  await page.keyboard.press("Control+k")
  await page.getByRole("dialog").getByRole("combobox").fill("Visão geral")
  await page.getByRole("dialog").getByRole("option").click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.keyboard.press("Escape")
  expect(confirmations).toBe(4)
  await expect(name).toHaveValue("Continuar editando")
  await expect(page).toHaveURL(/\/cadastros\/produtos\/novo$/)
})

test("histórico e recarga recuperam a edição sem depender do cache da rota", async ({ page }) => {
  await page.goto("/cadastros/produtos")
  await page.getByRole("link", { name: "Novo produto", exact: true }).click()
  const name = page.getByRole("textbox", { name: "Nome do produto", exact: true })
  await name.fill("Edição pelo histórico")
  page.on("dialog", dialog => dialog.accept())
  await page.goBack()
  await expect(page).toHaveURL(/\/cadastros\/produtos$/)
  await page.goForward()
  await expect(name).toHaveValue("Edição pelo histórico")
  await page.reload()
  await expect(name).toHaveValue("Edição pelo histórico")
  await expect(page.getByRole("status").filter({ hasText: "Rascunho recuperado" })).toBeVisible()
})

test("criação incerta recupera a mesma chave e corpo e limpa o rascunho após confirmação", async ({ page }) => {
  const commands: { key: string | undefined; body: string | null }[] = []
  await page.route("**/api/erp/products", route => {
    if (route.request().method() !== "POST") return route.fallback()
    commands.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() })
    return route.fulfill(commands.length === 1 ? { status: 503, json: { title: "Confirmação indisponível" } } : { status: 201, json: { data: product } })
  })
  await page.goto("/cadastros/produtos/novo")
  await page.getByRole("textbox", { name: "Nome do produto", exact: true }).fill("Criação pendente")
  await page.getByRole("textbox", { name: "SKU", exact: true }).fill("PENDING-001")
  await page.getByRole("button", { name: "Salvar produto", exact: true }).click()
  await expect(page.getByRole("button", { name: "Conferir gravação", exact: true })).toBeEnabled()
  await expect(page.getByRole("button", { name: "Descartar rascunho", exact: true })).toBeDisabled()
  page.on("dialog", dialog => dialog.accept())
  await page.reload()
  await expect(page.getByRole("textbox", { name: "Nome do produto", exact: true })).toHaveValue("Criação pendente")
  await page.getByRole("button", { name: "Conferir gravação", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/cadastros/produtos/${productId}$`))
  expect(commands).toHaveLength(2)
  expect(commands[0].key).toBeTruthy()
  expect(commands[1]).toEqual(commands[0])
  await page.goto("/cadastros/produtos/novo")
  await expect(page.getByRole("textbox", { name: "Nome do produto", exact: true })).toHaveValue("")
})

test("revisão alterada conserva edição e impede sobrescrever até recarregar", async ({ page }) => {
  await page.goto(`/cadastros/produtos/${productId}/editar`)
  const name = page.getByRole("textbox", { name: "Nome do produto", exact: true })
  await name.fill("Minha edição")
  await page.route(`**/api/erp/products/${productId}`, route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: { ...product, name: "Revisão do servidor", revision: 2 } }, headers: { etag: '"revision-2"' } }))
  page.on("dialog", dialog => dialog.accept())
  await page.reload()
  await expect(name).toHaveValue("Minha edição")
  await expect(page.getByRole("alert").filter({ hasText: "mudou no servidor" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Salvar produto", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Recarregar cadastro", exact: true }).click()
  await expect(name).toHaveValue("Revisão do servidor")
})

test("rascunho não atravessa empresa nem sessão", async ({ context, page }) => {
  await page.goto("/cadastros/produtos/novo")
  const name = page.getByRole("textbox", { name: "Nome do produto", exact: true })
  await name.fill("Somente empresa A")
  page.on("dialog", dialog => dialog.accept())
  const otherTenant = "33333333-3333-4333-8333-333333333333"
  await authenticate(context, otherTenant)
  await page.route("**/api/erp/products?*", route => route.fulfill({ json: { tenantId: otherTenant, canEdit: true, data: [], total: 0 } }))
  await page.reload()
  await expect(name).toHaveValue("")
  await authenticate(context)
  await page.unroute("**/api/erp/products?*")
  await page.reload()
  await expect(name).toHaveValue("Somente empresa A")
  await authenticate(context, tenant, "another-identity-fixture")
  await page.reload()
  await expect(name).toHaveValue("")
})

test("armazenamento indisponível informa o problema antes de despachar gravação", async ({ page }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("erp:product-draft:")) throw new DOMException("Storage unavailable", "QuotaExceededError")
      return setItem.call(this, key, value)
    }
  })
  let writes = 0
  page.on("request", request => { if (request.method() === "POST") writes++ })
  await page.goto("/cadastros/produtos/novo")
  await page.getByRole("textbox", { name: "Nome do produto", exact: true }).fill("Não perder")
  await page.getByRole("textbox", { name: "SKU", exact: true }).fill("NO-STORAGE")
  await expect(page.getByRole("alert").filter({ hasText: "armazenamento" })).toBeVisible()
  await page.getByRole("button", { name: "Salvar produto", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "confirmação da gravação" })).toBeVisible()
  expect(writes).toBe(0)
})

test("rascunho inválido não é aplicado nem sobrescrito silenciosamente", async ({ page }) => {
  await page.goto("/cadastros/produtos/novo")
  const name = page.getByRole("textbox", { name: "Nome do produto", exact: true })
  await name.fill("Edição válida")
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith("erp:product-draft:")))).toBe(true)
  await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find(key => key.startsWith("erp:product-draft:"))!
    sessionStorage.setItem(key, "invalid-json")
  })
  page.on("dialog", dialog => dialog.accept())
  await page.reload()
  await expect(name).toHaveValue("")
  await expect(page.getByRole("alert").filter({ hasText: "Não foi possível recuperar" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Salvar produto", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Descartar rascunho", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Não foi possível recuperar" })).toHaveCount(0)
})

test("permissão de consulta não restaura edição nem habilita gravação", async ({ page }) => {
  await page.goto(`/cadastros/produtos/${productId}/editar`)
  const name = page.getByRole("textbox", { name: "Nome do produto", exact: true })
  await name.fill("Rascunho privado")
  await page.route(`**/api/erp/products/${productId}`, route => route.fulfill({ json: { tenantId: tenant, canEdit: false, data: product }, headers: { etag: '"revision-1"' } }))
  page.on("dialog", dialog => dialog.accept())
  await page.reload()
  await expect(name).toHaveValue(product.name)
  await expect(name).toBeDisabled()
  await expect(page.getByRole("button", { name: "Salvar produto", exact: true })).toBeDisabled()
  await expect(page.getByRole("status").filter({ hasText: "Rascunho recuperado" })).toHaveCount(0)
})

test("criação interrompida em voo mantém comando para conferir após recarga", async ({ page }) => {
  let release: (() => void) | undefined
  const blockedResponse = new Promise<void>(resolve => { release = resolve })
  const commands: string[] = []
  await page.route("**/api/erp/products", async route => {
    if (route.request().method() !== "POST") return route.fallback()
    commands.push(route.request().headers()["idempotency-key"])
    if (commands.length === 1) { await blockedResponse; await route.abort().catch(() => {}); return }
    return route.fulfill({ status: 201, json: { data: product } })
  })
  try {
    await page.goto("/cadastros/produtos/novo")
    await page.getByRole("textbox", { name: "Nome do produto", exact: true }).fill("Em voo")
    await page.getByRole("textbox", { name: "SKU", exact: true }).fill("IN-FLIGHT")
    await page.getByRole("button", { name: "Salvar produto", exact: true }).click()
    await expect.poll(() => commands.length).toBe(1)
    page.on("dialog", dialog => dialog.accept())
    await page.reload()
    release!()
    await expect(page.getByRole("button", { name: "Conferir gravação", exact: true })).toBeEnabled()
    await page.getByRole("button", { name: "Conferir gravação", exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/cadastros/produtos/${productId}$`))
    expect(commands).toHaveLength(2)
    expect(commands[1]).toBe(commands[0])
  } finally { release!() }
})

test("espaço inferior mantém retry acessível e não reserva barra oculta no desktop", async ({ page }) => {
  await page.route("**/api/erp/products?*", route => route.fulfill({ status: 503, json: { title: "Consulta indisponível" } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/cadastros/produtos")
  await expect(page.getByRole("button", { name: "Tentar novamente", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click({ trial: true })
  await page.setViewportSize({ width: 1600, height: 950 })
  await expect(page.getByRole("navigation", { name: "Navegação móvel", exact: true })).toBeHidden()
  await expect(page.locator("#conteudo-principal")).toHaveCSS("padding-bottom", "0px")
})

test("edição sem confirmação oferece conferência mesmo sem mudança de revisão", async ({ page }) => {
  await page.goto(`/cadastros/produtos/${productId}/editar`)
  const name = page.getByRole("textbox", { name: "Nome do produto", exact: true })
  await name.fill("Edição não confirmada")
  await page.getByRole("button", { name: "Salvar produto", exact: true }).click()
  await expect(page.getByRole("button", { name: "Recarregar cadastro", exact: true })).toBeVisible()
  page.on("dialog", dialog => dialog.accept())
  await page.reload()
  await expect(name).toHaveValue("Edição não confirmada")
  await expect(page.getByRole("alert").filter({ hasText: "gravação anterior precisa ser conferida" })).toBeVisible()
  await page.getByRole("button", { name: "Recarregar cadastro", exact: true }).click()
  await expect(name).toHaveValue(product.name)
})
