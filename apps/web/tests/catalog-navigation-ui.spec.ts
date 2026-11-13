import { expect, test, type BrowserContext } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { origin, secret } from "../playwright.danfe.config"

const tenant = "11111111-1111-4111-8111-111111111111"
const productId = "22222222-2222-4222-8222-222222222222"
const product = { id: productId, name: "Produto de teste", sku: "TEST-001", unit: "UN", ncm: null, cest: null, basePrice: "12.50", status: "active", revision: 1 }

test("publicação de preços mantém prévia e versão publicada legíveis sem corte", async ({ context, page }, info) => {
  await authenticate(context)
  let publishes = 0
  const item = { productId, sku: "LD-A020", name: "Suporte de Agachamento Búlgaro e Levantamentos", priceWithoutIpiCents: 1113719, ipiBps: 1300, priceWithIpiCents: 1258562 }
  await page.route("**/api/erp/price-tables/**", route => {
    const path = new URL(route.request().url()).pathname
    const line = path.includes("national") ? "national" : "imported"
    if (route.request().method() !== "GET") publishes++
    return route.fulfill({ headers: { ETag: '"7"' }, json: path.endsWith("/preview")
      ? { tenantId: tenant, line, revision: 7, digest: "a".repeat(64), items: [item] }
      : { tenantId: tenant, line, data: { version: 6, publishedAt: "2026-11-09T18:13:45Z", items: [item] } } })
  })
  await page.goto("/preferencias/tabela-precos")
  for (const line of ["imported", "national"]) {
    await page.getByRole("combobox", { name: "Linha comercial", exact: true }).selectOption(line)
    await page.getByRole("button", { name: "Preparar prévia", exact: true }).click()
    await expect(page.getByRole("button", { name: "Confirmar publicação", exact: true })).toBeVisible()
    const tables = page.getByRole("table", { name: "Produtos da tabela de preços", exact: true })
    await expect(tables).toHaveCount(2)
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 852 })
      for (const table of await tables.all()) {
        expect(await table.evaluate(element => element.parentElement!.scrollWidth <= element.parentElement!.clientWidth + 1)).toBe(true)
        await expect(table.getByText("R$ 12.585,62", { exact: true })).toBeVisible()
        await expect(table.getByText("R$ 11.137,19", { exact: true }).filter({ visible: true })).toBeVisible()
        await expect(table.getByText("13%", { exact: true }).filter({ visible: true })).toBeVisible()
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
  }
  expect(publishes).toBe(0)
  await page.setViewportSize({ width: 390, height: 852 })
  await page.screenshot({ path: info.outputPath("price-publication-mobile.png"), fullPage: true })
})

async function authenticate(context: BrowserContext, tenantId = tenant, token = "catalog-navigation-fixture") {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: token, tenantId, expiresAt: Date.now() + 3600_000 })), cipher.final()])
  await context.addCookies([{ name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" }])
}

test.beforeEach(async ({ context, page }) => {
  await authenticate(context)
  await page.route("**/api/erp/**", route => route.fulfill({ status: 503, json: { title: "Consulta não configurada nesta fixture" } }))
  await page.route("**/api/erp/products**", route => {
    if (route.request().method() !== "GET") return route.fulfill({ status: 500, json: { title: "Gravação não configurada nesta fixture" } })
    if (new URL(route.request().url()).pathname.endsWith("/catalog")) return route.fulfill({ status: 404, json: { title: "Ficha de apresentação ainda não cadastrada" } })
    const detail = new URL(route.request().url()).pathname.endsWith(productId)
    return route.fulfill({ json: { tenantId: tenant, canEdit: true, data: detail ? product : Array.from({ length: 25 }, (_, index) => ({ ...product, id: `${productId.slice(0, -2)}${String(index).padStart(2, "0")}`, name: `Produto de teste ${index + 1}` })), total: 50 }, headers: { etag: '"revision-1"' } })
  })
})

test("produtos mantém a lista compacta e o caminho de navegação na criação, consulta e edição", async ({ page }) => {
  await page.goto("/cadastros/produtos")
  await expect(page.getByRole("table", { name: "Catálogo de produtos" })).toBeVisible()
  await expect(page.getByRole("navigation", { name: "Caminho de navegação", exact: true })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Novo produto", exact: true })).toHaveAttribute("href", "/cadastros/produtos/novo")
  for (const [route, current] of [
    ["/cadastros/produtos/novo", "Novo produto"],
    [`/cadastros/produtos/${productId}`, product.name],
    [`/cadastros/produtos/${productId}/editar`, "Editar produto"],
  ]) {
    await page.goto(route)
    const path = page.getByRole("navigation", { name: "Caminho de navegação", exact: true })
    await expect(path.getByRole("link", { name: "Cadastros", exact: true })).toHaveAttribute("href", "/cadastros")
    await expect(path.getByRole("link", { name: "Produtos", exact: true })).toHaveAttribute("href", "/cadastros/produtos")
    await expect(path.locator('[aria-current="page"]')).toHaveText(current)
    if (route.endsWith("/editar")) await expect(path.getByRole("link", { name: product.name, exact: true })).toHaveAttribute("href", `/cadastros/produtos/${productId}`)
  }
})

test("cadastro identifica a empresa pelo nome e não mistura empresas em respostas divergentes", async ({ page }) => {
  for (const scenario of ["same", "different", "unavailable"]) {
    let consulted = false
    await page.route("**/api/erp/me", route => {
      consulted = true
      return route.fulfill(scenario === "unavailable"
        ? { status: 503, json: { title: "Consulta indisponível" } }
        : { json: { tenant: { id: scenario === "same" ? tenant : productId, legalName: "Empresa identificada pelo nome" } } })
    })
    await page.goto(`/cadastros/produtos/${productId}/editar`)
    await expect(page.getByRole("textbox", { name: "Nome do produto", exact: true })).toHaveValue(product.name)
    await expect.poll(() => consulted).toBe(true)
    if (scenario === "same") await expect(page.getByText("Empresa: Empresa identificada pelo nome", { exact: true })).toBeVisible()
    else await expect(page.getByText("Empresa: Empresa identificada pelo nome", { exact: true })).toHaveCount(0)
    await expect(page.locator("main")).not.toContainText(tenant)
    await expect(page.locator("main")).not.toContainText("Revisão 1")
    await page.unroute("**/api/erp/me")
  }
})

test("ações finais do catálogo ficam acima da navegação compacta", async ({ page }, testInfo) => {
  for (const width of [320, 390, 768, 1280, 1599]) {
    await page.setViewportSize({ width, height: 844 })
    for (const route of ["/cadastros/produtos", "/cadastros/produtos/novo"]) {
      await page.goto(route)
      const action = page.getByRole("button", { name: route.endsWith("novo") ? "Salvar produto" : "Próxima", exact: true })
      await expect(action).toBeEnabled({ timeout: 30_000 })
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
      const box = await action.boundingBox()
      // Chromium can round the final scroll position by a few CSS pixels.
      expect(box!.y + box!.height, `${route} a ${width}px`).toBeLessThanOrEqual(848)
      await action.click({ trial: true })
      await action.focus()
      await expect(action).toBeFocused()
      if (width === 390) await page.screenshot({ path: testInfo.outputPath(route.endsWith("novo") ? "product-editor-mobile.png" : "products-mobile.png") })
    }
  }
})

test("catálogo mantém produto e dados essenciais visíveis em telas estreitas", async ({ page }) => {
  await page.goto("/cadastros/produtos")
  for (const width of [390, 915, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const table = page.getByRole("table", { name: "Catálogo de produtos" })
    await expect(table).toBeVisible()
    await expect(table.getByRole("link", { name: "Produto de teste 1", exact: true })).toBeVisible()
    if (width === 390) {
      await expect(table.getByRole("link", { name: "Produto de teste 1", exact: true })).toHaveText("Produto de teste 1")
      await expect(table.getByRole("row").filter({ hasText: "Produto de teste 1" }).first()).toContainText("R$ 12,50")
      expect(await page.getByRole("region", { name: "Lista de produtos" }).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test("catálogo separa nome e metadados e agrupa o preço sem rolagem lateral", async ({ page }) => {
  const name = "Equipamento para exercícios com identificação comercial completa no catálogo"
  await page.route("**/api/erp/products?*", route => route.fulfill({ json: { tenantId: tenant, canEdit: true, total: 1, data: [{ ...product, name, basePrice: "19419.84", hasPhoto: false }] } }))
  await page.goto("/cadastros/produtos")
  const table = page.getByRole("table", { name: "Catálogo de produtos", exact: true })
  for (const width of [320, 390, 640, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    const link = table.getByRole("link", { name, exact: true })
    await expect(link).toHaveText(name)
    await expect(link).toHaveAttribute("title", name)
    if (width < 1024) expect((await link.boundingBox())!.height).toBeLessThanOrEqual(44)
    await expect(table.getByText("R$ 19.419,84", { exact: true }).filter({ visible: true })).toBeVisible()
    await expect(table.getByRole("row").filter({ hasText: name })).toContainText(product.sku)
    expect(await table.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test("consulta e edição do produto agrupam os campos e limitam a foto no celular", async ({ page }, info) => {
  const photoDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1nQAAAAASUVORK5CYII="
  const stored = { ...product, basePrice: "19419.84", ncm: "85176259", cest: "1234567", photoDataUrl, structureColors: ["Preto"], swingArmColors: ["Vermelho"], upholsteryColors: ["Azul"], plateHolderColors: ["Cinza"], plateHolderTypes: ["Standard"] }
  let saved: Record<string, unknown> | undefined
  await page.route("**/api/erp/product-categories?*", route => route.fulfill({ json: { tenantId: tenant, data: [], total: 0 } }))
  await page.route(`**/api/erp/products/${productId}`, route => {
    if (route.request().method() === "PUT") saved = route.request().postDataJSON()
    return route.fulfill({ json: { tenantId: tenant, canEdit: true, data: { ...stored, ...saved } }, headers: { etag: '"revision-1"' } })
  })
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 852 })
    await page.goto(`/cadastros/produtos/${productId}`)
    const facts = page.getByRole("group", { name: "Dados do produto", exact: true })
    await expect(facts).toContainText("R$ 19.419,84")
    for (const value of [stored.sku, stored.unit, stored.ncm, stored.cest, "Ativo"]) await expect(facts).toContainText(value)
    const sku = await facts.getByText("SKU", { exact: true }).boundingBox()
    const unit = await facts.getByText("Unidade", { exact: true }).boundingBox()
    expect(unit!.x).toBeGreaterThan(sku!.x)
    expect(unit!.y).toBe(sku!.y)
    expect((await page.getByRole("img", { name: "Foto cadastrada do produto", exact: true }).boundingBox())!.height).toBeLessThanOrEqual(192)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole("link", { name: "Editar produto", exact: true }).click()
    const name = page.getByRole("textbox", { name: "Nome do produto", exact: true })
    const photo = page.getByRole("region", { name: "Foto do produto", exact: true })
    await expect(name).toHaveValue(stored.name)
    expect((await photo.getByRole("img", { name: "Foto cadastrada do produto", exact: true }).boundingBox())!.height).toBeLessThanOrEqual(128)
    expect((await name.boundingBox())!.y).toBeLessThan((await photo.boundingBox())!.y)
    const skuInput = await page.getByRole("textbox", { name: "SKU", exact: true }).boundingBox()
    const unitInput = await page.getByRole("textbox", { name: "Unidade", exact: true }).boundingBox()
    expect(unitInput!.x).toBeGreaterThan(skuInput!.x)
    expect(unitInput!.y).toBe(skuInput!.y)
    expect(skuInput!.height).toBe(36)
    await expect(name).toHaveCSS("font-size", "16px")
    await expect(page.getByRole("textbox", { name: "Cores da estrutura", exact: true })).toHaveValue("Preto")
    await expect(page.getByRole("textbox", { name: "Cores dos braços", exact: true })).toHaveValue("Vermelho")
    await expect(page.getByRole("textbox", { name: "Cores do estofado", exact: true })).toHaveValue("Azul")
    expect((await page.getByRole("textbox", { name: "Cores da estrutura", exact: true }).boundingBox())!.height).toBeLessThanOrEqual(64)
    await expect(page.getByLabel("Tipo de anilheiro", { exact: true })).toHaveCount(0)
    await expect(page.getByLabel("Cores dos anilheiros", { exact: true })).toHaveCount(0)
    await photo.getByText("Alterar foto", { exact: true }).click()
    await expect(photo.getByLabel("Selecionar foto do produto", { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.getByRole("textbox", { name: "Preço base (R$)", exact: true }).fill("19419,84")
  await page.getByRole("button", { name: "Salvar produto", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Produto salvo" })).toBeVisible()
  expect(saved).toMatchObject({ basePrice: "19419.84", structureColors: ["Preto"], swingArmColors: ["Vermelho"], upholsteryColors: ["Azul"], plateHolderColors: ["Cinza"], plateHolderTypes: ["Standard"] })
  await page.screenshot({ path: info.outputPath("product-editor-compact-mobile.png"), fullPage: true })
})

test("tabela publicada mantém preços desconto e ação acessíveis no celular", async ({ page }) => {
  await page.route("**/api/erp/commercial/tables/*", route => route.fulfill({ json: { tenantId: tenant, line: "imported", canManage: true, data: { id: productId, version: 1, publishedAt: "2026-11-09T12:00:00Z", freeDiscountBps: 750, minimumDownPaymentBps: 5000, originState: "SP", items: [{ productId, name: "Equipamento com nome extenso para consulta comercial", sku: "EQUIP-001", unit: "UN", priceWithoutIpiCents: 1941984, priceWithIpiCents: 2136182, ipiBps: 1000 }] } } }))
  await page.goto("/vendas/tabela-precos")
  const table = page.getByRole("table", { name: "Preços publicados", exact: true })
  for (const width of [320, 390, 640, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(table).toBeVisible()
    if (width < 1024 && await table.locator("details").getAttribute("open") === null) await table.locator("summary").click()
    await expect(table.getByText("R$ 19.419,84", { exact: true }).filter({ visible: true })).toBeVisible()
    await expect(table.getByText("R$ 21.361,82", { exact: true })).toBeVisible()
    await expect(table.getByText(/Com 7,5% desc\. \+ IPI/).filter({ visible: true })).toBeVisible()
    const action = table.getByRole("link", { name: "Simular pedido", exact: true })
    const href = new URL((await action.getAttribute("href"))!, "http://erp.local")
    expect(href.pathname).toBe("/vendas/simulador")
    expect(href.searchParams.get("linha")).toBe("imported")
    expect(href.searchParams.get("produto")).toBe(productId)
    expect(href.searchParams.get("returnTo")).toBe("/vendas/tabela-precos")
    const box = await action.boundingBox()
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    expect(await table.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test("estoque usa linhas selecionáveis e quantidades legíveis sem perder precisão", async ({ page }) => {
  await page.route("**/api/erp/stock?*", route => route.fulfill({ json: { tenantId: tenant, canEdit: false, total: 1, data: [{ productId, name: product.name, sku: product.sku, unit: "UN", status: "active", quantity: "1234.500000", reserved: "0.000001", available: "1234.499999" }] } }))
  await page.route("**/api/erp/stock/movements?*", route => route.fulfill({ json: { tenantId: tenant, canEdit: false, total: 1, data: [{ id: "33333333-3333-4333-8333-333333333333", productId, direction: "receipt", quantity: "1234.500000", balanceAfter: "1234.500000", reason: "Entrada conferida", occurredAt: "2026-11-09T12:00:00Z", reversesId: null, sourceOrderId: null }] } }))
  await page.goto("/estoque/saldos")
  const table = page.getByRole("table", { name: "Saldos por produto", exact: true })
  for (const width of [320, 390, 640, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(table).toBeVisible()
    await expect(table.getByText("1.234,5 UN", { exact: true })).toBeVisible()
    await expect(table.getByText("0,000001", { exact: true }).filter({ visible: true })).toBeVisible()
    await expect(table.getByText("1.234,499999", { exact: true }).filter({ visible: true })).toBeVisible()
    expect(await table.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  const select = table.getByRole("button", { name: new RegExp(`^${product.name} SKU `) })
  await select.focus()
  await page.keyboard.press("Enter")
  await expect(select).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("region", { name: "Movimentos do produto", exact: true })).toContainText("Entrada de 1.234,5 UN")
  await expect(page.getByText("Somente consulta. Você não pode movimentar o estoque.", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Confirmar lançamento", exact: true })).toHaveCount(0)
})

test("Início pede confirmação e cancelar preserva a edição", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/cadastros/produtos/novo")
  const name = page.getByRole("textbox", { name: "Nome do produto", exact: true })
  await name.fill("Edição que deve continuar")
  let confirmations = 0
  page.on("dialog", async dialog => { confirmations++; await dialog.dismiss() })
  await page.getByRole("button", { name: "Abrir menu", exact: true }).click()
  await page.getByRole("dialog").getByRole("link", { name: "Visão geral", exact: true }).click()
  expect(confirmations).toBe(1)
  await expect(page).toHaveURL(/\/cadastros\/produtos\/novo$/)
  await page.getByRole("dialog").getByRole("button", { name: "Fechar menu", exact: true }).click()
  await expect(name).toHaveValue("Edição que deve continuar")
})

test("reabrir recupera o rascunho e descartar o remove", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/cadastros/produtos/novo")
  const name = page.getByRole("textbox", { name: "Nome do produto", exact: true })
  await name.fill("Rascunho recuperável")
  page.on("dialog", dialog => dialog.accept())
  await page.getByRole("button", { name: "Abrir menu", exact: true }).click()
  await page.getByRole("dialog").getByRole("link", { name: "Visão geral", exact: true }).click()
  await expect(page).toHaveURL(origin + "/")
  await page.goto("/cadastros/produtos/novo")
  await expect(name).toHaveValue("Rascunho recuperável")
  await expect(page.getByRole("status").filter({ hasText: "Rascunho recuperado" })).toBeVisible()
  await page.getByRole("button", { name: "Descartar rascunho", exact: true }).click()
  await expect(name).toHaveValue("")
  await page.reload()
  await expect(name).toHaveValue("")
})

test("rascunho preserva foto grande e cores ao reabrir e salvar", async ({ page }) => {
  await page.goto("/cadastros/produtos")
  const photoDataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas")
    canvas.width = 256; canvas.height = 256
    const context = canvas.getContext("2d")!
    const image = context.createImageData(256, 256)
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = (i * 13) % 251; image.data[i + 1] = (i * 29) % 253
      image.data[i + 2] = (i * 7) % 255; image.data[i + 3] = 255
    }
    context.putImageData(image, 0, 0)
    return canvas.toDataURL("image/jpeg", 0.85)
  })
  expect(photoDataUrl.length).toBeGreaterThan(20_000)
  const stored = { ...product, structureColors: ["Preto"], upholsteryColors: ["Azul"], photoDataUrl }
  let saved: Record<string, unknown> | undefined
  await page.route(`**/api/erp/products/${productId}`, async route => {
    if (route.request().method() === "PUT") saved = route.request().postDataJSON()
    await route.fulfill({ json: { tenantId: tenant, canEdit: true, data: { ...stored, ...saved } }, headers: { etag: '"revision-1"' } })
  })
  await page.goto(`/cadastros/produtos/${productId}/editar`)
  await page.getByRole("textbox", { name: "Nome do produto", exact: true }).fill("Produto com foto recuperada")
  await page.getByRole("textbox", { name: "Cores da estrutura", exact: true }).fill("Preto\nBranco")
  page.on("dialog", dialog => dialog.accept())
  await page.reload()
  await expect(page.getByRole("status").filter({ hasText: "Rascunho recuperado" })).toBeVisible({ timeout: process.env.ERP_BROWSER_DEV === "1" ? 30_000 : 5_000 })
  await expect(page.getByRole("img", { name: "Foto cadastrada do produto" })).toHaveAttribute("src", photoDataUrl)
  await expect(page.getByRole("textbox", { name: "Cores da estrutura", exact: true })).toHaveValue("Preto\nBranco")
  await page.getByRole("button", { name: "Salvar produto", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Produto salvo" })).toBeVisible()
  expect(saved).toMatchObject({ photoDataUrl, structureColors: ["Preto", "Branco"], upholsteryColors: ["Azul"], name: "Produto com foto recuperada" })
})

test("rascunho antigo mantém os acabamentos atuais do servidor", async ({ page }) => {
  await page.route(`**/api/erp/products/${productId}`, route => route.fulfill({
    json: { tenantId: tenant, canEdit: true, data: { ...product, structureColors: ["Preto"], swingArmColors: ["Vermelho"], upholsteryColors: ["Azul"] } },
    headers: { etag: '"revision-1"' },
  }))
  await page.goto(`/cadastros/produtos/${productId}/editar`)
  await page.getByRole("textbox", { name: "Nome do produto", exact: true }).fill("Edição anterior")
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith("erp:product-draft:")))).toBe(true)
  await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find(key => key.startsWith("erp:product-draft:"))!
    const stored = JSON.parse(sessionStorage.getItem(key)!)
    for (const field of ["structureColors", "swingArmColors", "upholsteryColors", "photoDataUrl"]) delete stored.draft[field]
    sessionStorage.setItem(key, JSON.stringify(stored))
  })
  page.on("dialog", dialog => dialog.accept())
  await page.reload()
  await expect(page.getByRole("textbox", { name: "Nome do produto", exact: true })).toHaveValue("Edição anterior", { timeout: process.env.ERP_BROWSER_DEV === "1" ? 30_000 : 5_000 })
  await expect(page.getByRole("textbox", { name: "Cores da estrutura", exact: true })).toHaveValue("Preto")
  await expect(page.getByRole("textbox", { name: "Cores dos braços", exact: true })).toHaveValue("Vermelho")
  await expect(page.getByRole("textbox", { name: "Cores do estofado", exact: true })).toHaveValue("Azul")
})

test("menu desktop, módulos, busca e breadcrumb respeitam cancelamento", async ({ page }) => {
  await page.setViewportSize({ width: 1749, height: 950 })
  await page.goto("/cadastros/produtos/novo")
  const name = page.getByRole("textbox", { name: "Nome do produto", exact: true })
  await name.fill("Continuar editando")
  let confirmations = 0
  page.on("dialog", async dialog => { confirmations++; await dialog.dismiss() })
  const desktop = page.getByRole("navigation", { name: "Módulos do ERP", exact: true })
  if (await desktop.getByRole("button", { name: "Cadastros", exact: true }).getAttribute("aria-expanded") !== "true") await desktop.getByRole("button", { name: "Cadastros", exact: true }).click()
  await desktop.getByRole("link", { name: "Produtos", exact: true }).click()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("link", { name: "Voltar ao catálogo", exact: true })).toHaveCount(0)
  await page.getByRole("navigation", { name: "Caminho de navegação", exact: true }).getByRole("link", { name: "Produtos", exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "Abrir menu", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Cadastros", exact: true }).click()
  await page.getByRole("dialog").getByRole("link", { name: "Produtos", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.keyboard.press("Escape")
  await page.keyboard.press("Control+k")
  await page.getByRole("dialog").getByRole("combobox").fill("Visão geral")
  await page.getByRole("dialog").getByRole("option", { name: /^Visão geral\b/ }).click()
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
  await expect(page.locator("#conteudo-principal")).toHaveCSS("padding-bottom", "32px")
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

test("confirmação tardia não redireciona quem já saiu do editor", async ({ page }) => {
  let release: (() => void) | undefined
  const blockedResponse = new Promise<void>(resolve => { release = resolve })
  await page.route("**/api/erp/products", async route => {
    if (route.request().method() !== "POST") return route.fallback()
    await blockedResponse
    await route.fulfill({ status: 201, json: { data: product } })
  })
  try {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/cadastros/produtos/novo")
    await page.getByRole("textbox", { name: "Nome do produto", exact: true }).fill("Resposta tardia")
    await page.getByRole("textbox", { name: "SKU", exact: true }).fill("LATE-RESPONSE")
    const sent = page.waitForRequest(request => request.method() === "POST")
    const response = page.waitForResponse(response => response.request().method() === "POST")
    await page.getByRole("button", { name: "Salvar produto", exact: true }).click()
    await sent
    page.on("dialog", dialog => dialog.accept())
    await page.getByRole("button", { name: "Abrir menu", exact: true }).click()
    await page.getByRole("dialog").getByRole("link", { name: "Visão geral", exact: true }).click()
    await expect(page).toHaveURL(origin + "/")
    release!()
    await response
    await page.waitForLoadState("networkidle")
    await expect(page).toHaveURL(origin + "/")
    await page.goto("/cadastros/produtos/novo")
    await expect(page.getByRole("textbox", { name: "Nome do produto", exact: true })).toHaveValue("")
  } finally { release!() }
})
