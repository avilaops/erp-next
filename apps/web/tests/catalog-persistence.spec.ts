import { test, expect, type BrowserContext } from "@playwright/test"
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

test("catálogo conectado grava produto, preço decimal e edição com revisão", async ({ page, context }) => {
  await session(context)
  await page.goto("/cadastros/produtos")
  await page.getByRole("link", { name: "Novo produto", exact: true }).click()
  await page.getByRole("textbox", { name: "Nome do produto", exact: true }).fill("Parafuso do navegador")
  await page.getByRole("textbox", { name: "SKU", exact: true }).fill("BROWSER-001")
  await page.getByRole("textbox", { name: "Preço base (R$)", exact: true }).fill("0,10")
  await page.getByRole("button", { name: "Salvar produto", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Parafuso do navegador", exact: true })).toBeVisible()
  await expect(page.getByText("R$ 0,10", { exact: true })).toBeVisible()
  const id = new URL(page.url()).pathname.split("/").at(-1)!
  await page.getByRole("link", { name: "Editar produto", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/cadastros/produtos/${id}/editar$`))
  await page.getByRole("textbox", { name: "Nome do produto", exact: true }).fill("Parafuso revisado")
  await page.getByRole("button", { name: "Salvar produto", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Produto salvo no servidor." })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("textbox", { name: "Nome do produto", exact: true })).toHaveValue("Parafuso revisado")
  const saved = await (await context.request.get(`/api/erp/products/${id}`)).json()
  expect(saved.data.basePrice).toBe("0.10")
  expect(saved.data.revision).toBe(2)
  const filtered = await (await context.request.get("/api/erp/products?q=BROWSER-001&limit=1")).json()
  expect(filtered.total).toBe(1)
  expect(filtered.data[0].id).toBe(id)
})

test("SKU duplicado permite corrigir a edição sem descartar os outros campos", async ({ page, context }) => {
  await session(context)
  const input = { sku: "PILOT-SKU-A", name: "Produto para corrigir SKU", unit: "UN", ncm: null, cest: null, basePrice: "10.00", status: "active" }
  const first = await context.request.post("/api/erp/products", { headers: { ...headers, "Idempotency-Key": randomUUID() }, data: input })
  expect(first.status()).toBe(201)
  const id = (await first.json()).data.id
  const second = await context.request.post("/api/erp/products", { headers: { ...headers, "Idempotency-Key": randomUUID() }, data: { ...input, sku: "PILOT-SKU-B" } })
  expect(second.status()).toBe(201)
  await page.goto(`/cadastros/produtos/${id}/editar`)
  await expect(page.getByRole("textbox", { name: "Nome do produto", exact: true })).toHaveValue(input.name)
  await page.getByRole("textbox", { name: "Nome do produto", exact: true }).fill("Nome preservado na correção")
  await page.getByRole("textbox", { name: "SKU", exact: true }).fill("PILOT-SKU-B")
  const rejected = page.waitForResponse(response => response.url().endsWith(`/api/erp/products/${id}`) && response.request().method() === "PUT")
  await page.getByRole("button", { name: "Salvar produto", exact: true }).click()
  expect((await rejected).status()).toBe(409)
  await expect(page.getByRole("alert").filter({ hasText: "SKU" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Salvar produto", exact: true })).toBeEnabled()
  await expect(page.getByRole("textbox", { name: "Nome do produto", exact: true })).toHaveValue("Nome preservado na correção")
  await page.getByRole("textbox", { name: "SKU", exact: true }).fill("PILOT-SKU-C")
  await page.getByRole("textbox", { name: "Preço base (R$)", exact: true }).fill("12.5")
  await page.getByRole("button", { name: "Salvar produto", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Produto salvo no servidor." })).toBeVisible()
  const saved = await (await context.request.get(`/api/erp/products/${id}`)).json()
  expect(saved.data).toMatchObject({ sku: "PILOT-SKU-C", name: "Nome preservado na correção", basePrice: "12.50", revision: 2 })
})

test("preço com precisão excessiva não é arredondado e o usuário pode corrigir o formulário", async ({ page, context }) => {
  await session(context)
  await page.goto("/cadastros/produtos/novo")
  await page.getByRole("textbox", { name: "Nome do produto", exact: true }).fill("Produto com preço corrigido")
  await page.getByRole("textbox", { name: "SKU", exact: true }).fill("PILOT-PRICE-001")
  await page.getByRole("textbox", { name: "Preço base (R$)", exact: true }).fill("1.234")
  await page.getByRole("button", { name: "Salvar produto", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "até duas casas decimais" })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Preço base (R$)", exact: true })).toHaveValue("1.234")
  const before = await (await context.request.get("/api/erp/products?q=PILOT-PRICE-001")).json()
  expect(before.total).toBe(0)
  await page.getByRole("textbox", { name: "Preço base (R$)", exact: true }).fill("1,23")
  await page.getByRole("button", { name: "Salvar produto", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Produto com preço corrigido", exact: true })).toBeVisible()
  await expect(page.getByText("R$ 1,23", { exact: true })).toBeVisible()
})

test("catálogo recusa sobrescrita de outra revisão preservando o formulário", async ({ page, context }) => {
  await session(context)
  const input = { sku: "CONFLICT-001", name: "Produto inicial", unit: "UN", ncm: null, cest: null, basePrice: "12.34", status: "active" }
  const created = await context.request.post("/api/erp/products", { headers: { ...headers, "Idempotency-Key": randomUUID() }, data: input })
  expect(created.status()).toBe(201)
  const id = (await created.json()).data.id
  await page.goto(`/cadastros/produtos/${id}/editar`)
  await expect(page.getByRole("textbox", { name: "Nome do produto", exact: true })).toHaveValue("Produto inicial")
  const remote = await context.request.get(`/api/erp/products/${id}`)
  expect((await context.request.put(`/api/erp/products/${id}`, { headers: { ...headers, "If-Match": remote.headers().etag }, data: { ...input, name: "Revisão remota" } })).status()).toBe(200)
  await page.getByRole("textbox", { name: "Nome do produto", exact: true }).fill("Minha edição local")
  await page.getByRole("button", { name: "Salvar produto", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Outra pessoa alterou" })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Nome do produto", exact: true })).toHaveValue("Minha edição local")
  await expect(page.getByRole("button", { name: "Salvar produto", exact: true })).toBeDisabled()
  page.once("dialog", dialog => dialog.accept())
  await page.getByRole("button", { name: "Recarregar cadastro", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Nome do produto", exact: true })).toHaveValue("Revisão remota")
})

test("catálogo em consulta bloqueia edição e mantém layout móvel", async ({ page, context }) => {
  await session(context)
  const created = await context.request.post("/api/erp/products", { headers: { ...headers, "Idempotency-Key": randomUUID() }, data: { sku: "MOBILE-READ-001", name: "Produto de consulta", unit: "UN", ncm: null, cest: null, basePrice: "1.00", status: "active" } })
  expect(created.status()).toBe(201)
  const id = (await created.json()).data.id
  await session(context, true)
  await page.setViewportSize({ width: 375, height: 844 })
  await page.goto(`/cadastros/produtos/${id}/editar`)
  await expect(page.getByText("Somente consulta.", { exact: false })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Nome do produto", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Salvar produto", exact: true })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})
