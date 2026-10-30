import { expect, test, type BrowserContext } from "@playwright/test"
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto"

const origin = process.env.ERP_TEST_WEB_ORIGIN || "http://127.0.0.1:3202"
const tenant = "11111111-1111-4111-8111-111111111111"
const headers = { Origin: origin, "X-Tenant-Id": tenant }

async function session(context: BrowserContext, reader = false) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(process.env.ERP_SESSION_SECRET!).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: reader ? "fixture-reader-token" : "fixture-editor-token", tenantId: tenant, expiresAt: Date.now() + 3600_000 })), cipher.final()])
  await context.addCookies([{ name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" }])
}

test("cores do equipamento são escolhidas, persistidas e preservadas após alteração do catálogo", async ({ page, context }, info) => {
  await session(context)
  const name = `Equipamento com acabamentos ${randomUUID().slice(0, 8)}`
  const sku = `COR-${randomUUID().slice(0, 8)}`.toUpperCase()
  await page.goto("/cadastros/produtos/novo")
  await page.getByLabel("Nome do produto", { exact: true }).fill(name)
  await page.getByLabel("SKU", { exact: true }).fill(sku)
  await page.getByLabel("Preço base (R$)", { exact: true }).fill("1200,00")
  await page.getByLabel("Selecionar foto do produto", { exact: true }).setInputFiles({ name: "equipamento.png", mimeType: "image/png", buffer: await page.screenshot() })
  await expect(page.getByRole("img", { name: "Foto cadastrada do produto", exact: true })).toBeVisible()
  await page.getByLabel("Cores da estrutura", { exact: true }).fill("Preto fosco\nBranco")
  await page.getByLabel("Cores do estofado", { exact: true }).fill("Preto\nVermelho")
  await page.getByRole("button", { name: "Salvar produto", exact: true }).click()
  await expect(page).toHaveURL(/\/cadastros\/produtos\/[a-f0-9-]{36}$/)
  const productId = new URL(page.url()).pathname.split("/").at(-1)!
  await expect(page.getByText("Preto fosco", { exact: true })).toBeVisible()
  const productResponse = await context.request.get(`/api/erp/products/${productId}`)
  const product = (await productResponse.json()).data
  expect(product.photoDataUrl).toMatch(/^data:image\/jpeg;base64,/)
  await expect(page.getByRole("img", { name: "Foto cadastrada do produto", exact: true })).toBeVisible()
  expect(product.structureColors).toEqual(["Preto fosco", "Branco"])
  expect(product.upholsteryColors).toEqual(["Preto", "Vermelho"])

  const customers = await (await context.request.get("/api/erp/parties?q=11222333000181")).json()
  let customer = customers.data[0]
  if (!customer) {
    const created = await context.request.post("/api/erp/parties", { headers: { ...headers, "Idempotency-Key": randomUUID() }, data: { personType: "juridica", legalName: "Cliente dos equipamentos", tradeName: null, taxId: "11222333000181", email: null, phone: null, isCustomer: true, isSupplier: false, status: "active" } })
    expect(created.status()).toBe(201)
    customer = (await created.json()).data
  }
  await page.goto("/vendas/pedidos/novo")
  await page.getByLabel("Buscar cliente", { exact: true }).fill(customer.legalName)
  await page.getByRole("button", { name: "Pesquisar cliente", exact: true }).click()
  await page.getByRole("button", { name: `Selecionar ${customer.legalName}`, exact: true }).click()
  await page.getByLabel("Buscar produto", { exact: true }).fill(sku)
  await page.getByRole("button", { name: "Pesquisar produto", exact: true }).click()
  await page.getByRole("button", { name: `Selecionar ${name} · ${sku}`, exact: true }).click()
  await page.getByLabel("Vencimento da conta a receber").fill("2026-11-27")
  await page.getByLabel(`Cor da estrutura de ${name}`, { exact: true }).selectOption("Branco")
  await page.getByLabel(`Cor do estofado de ${name}`, { exact: true }).selectOption("Vermelho")
  await page.setViewportSize({ width: 320, height: 844 })
  await page.screenshot({ path: info.outputPath("equipment-colors-choice-mobile.png"), fullPage: true })
  const overflow = await page.evaluate(() => Array.from(document.querySelectorAll("main *")).filter(element => element.getBoundingClientRect().right > innerWidth + 1).map(element => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right })).slice(0, 12))
  expect(overflow).toEqual([])
  await page.getByRole("button", { name: "Criar rascunho", exact: true }).click()
  await expect(page).toHaveURL(/\/vendas\/pedidos\/[a-f0-9-]{36}$/)
  const orderId = new URL(page.url()).pathname.split("/").at(-1)!
  await expect(page.getByText("Estrutura: Branco", { exact: true })).toBeVisible()
  await expect(page.getByText("Estofado: Vermelho", { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText("Estofado: Vermelho", { exact: true })).toBeVisible()

  const oldClientInput = { sku: product.sku, name: product.name, unit: product.unit, basePrice: "1400.00", ncm: product.ncm, cest: product.cest, status: product.status }
  const oldClientUpdate = await context.request.put(`/api/erp/products/${productId}`, { headers: { ...headers, "If-Match": productResponse.headers().etag }, data: oldClientInput })
  expect(oldClientUpdate.status()).toBe(200)
  expect((await oldClientUpdate.json()).data.structureColors).toEqual(["Preto fosco", "Branco"])
  expect((await (await context.request.get(`/api/erp/products/${productId}`)).json()).data.photoDataUrl).toBe(product.photoDataUrl)
  const revised = await context.request.get(`/api/erp/products/${productId}`)
  const changeColors = await context.request.put(`/api/erp/products/${productId}`, { headers: { ...headers, "If-Match": revised.headers().etag }, data: { ...oldClientInput, structureColors: ["Preto fosco"], upholsteryColors: ["Preto"] } })
  expect(changeColors.status()).toBe(200)
  await page.getByRole("link", { name: "Editar rascunho", exact: true }).click()
  await expect(page.getByLabel(`Cor da estrutura de ${name}`, { exact: true })).toHaveValue("Branco")
  await expect(page.getByLabel(`Cor do estofado de ${name}`, { exact: true })).toHaveValue("Vermelho")
  await page.getByLabel(`Quantidade de ${name}`, { exact: true }).fill("2")
  await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/vendas/pedidos/${orderId}$`))
  const savedResponse = await context.request.get(`/api/erp/orders/${orderId}`)
  const saved = await savedResponse.json()
  expect(saved.items[0]).toMatchObject({ structureColor: "Branco", upholsteryColor: "Vermelho", unitPrice: "1200.00", quantity: "2.000000" })
  const invalid = await context.request.post("/api/erp/orders", { headers: { ...headers, "Idempotency-Key": randomUUID() }, data: { customerId: customer.id, dueDate: "2026-11-27", items: [{ productId, quantity: "1", structureColor: "Cor não oferecida", upholsteryColor: "Preto" }] } })
  expect(invalid.status()).toBe(422)
  const missing = await context.request.post("/api/erp/orders", { headers: { ...headers, "Idempotency-Key": randomUUID() }, data: { customerId: customer.id, dueDate: "2026-11-27", items: [{ productId, quantity: "1" }] } })
  expect(missing.status()).toBe(422)
  const duplicate = await context.request.put(`/api/erp/products/${productId}`, { headers: { ...headers, "If-Match": changeColors.headers().etag }, data: { ...oldClientInput, structureColors: ["Preto", " preto "] } })
  expect(duplicate.status()).toBe(422)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath("equipment-colors-mobile.png"), fullPage: true })
  const invalidPhoto = await context.request.put(`/api/erp/products/${productId}`, { headers: { ...headers, "If-Match": changeColors.headers().etag }, data: { ...oldClientInput, photoDataUrl: "data:image/svg+xml;base64,PHN2Zy8+" } })
  expect(invalidPhoto.status()).toBe(422)
  await page.goto(`/cadastros/produtos/${productId}/editar`)
  await expect(page.getByRole("img", { name: "Foto cadastrada do produto", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Remover foto", exact: true }).click()
  await page.getByRole("button", { name: "Salvar produto", exact: true }).click()
  await expect(page.getByText("Produto salvo no servidor.", { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText("Nenhuma foto cadastrada", { exact: true })).toBeVisible()
  await session(context, true)
  expect((await context.request.put(`/api/erp/products/${productId}`, { headers: { ...headers, "If-Match": changeColors.headers().etag }, data: oldClientInput })).status()).toBe(403)
})
