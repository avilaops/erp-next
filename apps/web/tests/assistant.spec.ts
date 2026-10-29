import { test, expect, type BrowserContext } from "@playwright/test"
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto"

const origin = process.env.ERP_TEST_WEB_ORIGIN || "http://127.0.0.1:3202"
const tenant = "11111111-1111-4111-8111-111111111111"

async function session(context: BrowserContext) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(process.env.ERP_SESSION_SECRET!).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "fixture-editor-token", tenantId: tenant, expiresAt: Date.now() + 3600_000 })), cipher.final()])
  await context.addCookies([{ name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" }])
}

test("assistant BFF rejects anonymous access, cross origin and tenant changes", async ({ context, request }) => {
  const body = { questions: ["Olá"] }
  expect((await request.post("/api/erp/assistant", { data: body, headers: { Origin: origin } })).status()).toBe(401)
  await session(context)
  expect((await context.request.post("/api/erp/assistant", { data: body, headers: { Origin: "https://example.test", "X-Tenant-Id": tenant } })).status()).toBe(403)
  expect((await context.request.post("/api/erp/assistant", { data: body, headers: { Origin: origin, "X-Tenant-Id": randomUUID() } })).status()).toBe(409)
})

test("assistant mobile shows sources, empty results, errors, retry and interruption", async ({ page, context }) => {
  await session(context)
  await page.setViewportSize({ width: 390, height: 844 })
  let attempt = 0
  await page.route("**/api/erp/assistant", async route => {
    attempt++
    if (attempt === 1) return route.fulfill({ status: 503, json: { title: "Serviço de IA indisponível. Tente novamente." } })
    if (attempt === 3) { await new Promise(resolve => setTimeout(resolve, 3000)); return route.abort().catch(() => undefined) }
    return route.fulfill({ contentType: "application/x-ndjson", body: [
      { type: "tool", name: "buscar_produtos" },
      { type: "source", source: { tool: "buscar_produtos", origin: "API ERP · Produtos", total: 0, data: [] } },
      { type: "answer", kind: "erp", text: "Nenhum resultado encontrado para o termo informado." },
      { type: "done" },
    ].map(event => JSON.stringify(event)).join("\n") + "\n" })
  })
  await page.goto("/assistente")
  const input = page.getByRole("textbox", { name: "Mensagem para o assistente" })
  await expect(input).toBeEnabled()
  await input.fill("Busque NONEXISTENT")
  await page.getByRole("button", { name: "Enviar", exact: true }).click()
  await expect(page.getByRole("region", { name: "Conversa com o assistente" }).getByRole("alert")).toContainText("Serviço de IA indisponível")
  await page.getByRole("button", { name: "Tentar novamente" }).click()
  await expect(page.getByText("Confirmado pelo ERP", { exact: true })).toBeVisible()
  await expect(page.getByText("Nenhum resultado encontrado para o termo informado.", { exact: true })).toHaveCount(2)
  await input.fill("Busque SKU-123")
  await page.getByRole("button", { name: "Enviar", exact: true }).click()
  await page.getByRole("button", { name: "Interromper" }).click()
  await expect(page.getByRole("region", { name: "Conversa com o assistente" }).getByRole("alert")).toContainText("Geração interrompida")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test("assistant real local model consults Rust products and stock and opens the source", async ({ page, context }) => {
  test.skip(!process.env.ERP_ASSISTANT_OLLAMA_URL, "Requires an explicitly configured local inference service")
  await session(context)
  const headers = { Origin: origin, "X-Tenant-Id": tenant, "Idempotency-Key": randomUUID() }
  const created = await context.request.post("/api/erp/products", { headers, data: { sku: "ASSIST-123", name: "Parafuso de teste", unit: "UN", basePrice: "12.34", ncm: null, cest: null, status: "active" } })
  expect(created.status()).toBe(201)
  const product = await created.json()
  const productId = product.data?.id || product.id
  expect(productId).toBeTruthy()
  const moved = await context.request.post("/api/erp/stock/movements", { headers: { ...headers, "Idempotency-Key": randomUUID() }, data: { productId, direction: "receipt", quantity: "42.000000", reason: "Teste isolado do assistente", reversesId: null } })
  expect(moved.status(), await moved.text()).toBe(201)
  await page.goto("/assistente")
  const input = page.getByRole("textbox", { name: "Mensagem para o assistente" })
  await expect(input).toBeEnabled()
  await input.fill("Busque o produto pelo SKU ASSIST-123")
  await page.getByRole("button", { name: "Enviar", exact: true }).click()
  await expect(page.getByRole("link", { name: "Parafuso de teste" })).toBeVisible({ timeout: 105_000 })
  await expect(input).toBeEnabled({ timeout: 105_000 })
  await expect(page.getByRole("region", { name: "Conversa com o assistente" }).getByRole("alert")).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Parafuso de teste" })).toHaveAttribute("href", `/cadastros/produtos/${productId}`)
  await input.fill("Quanto temos de estoque do SKU ASSIST-123?")
  await page.getByRole("button", { name: "Enviar", exact: true }).click()
  await expect(page.getByText("Origem: API ERP · Estoque")).toBeVisible({ timeout: 105_000 })
  await expect(input).toBeEnabled({ timeout: 105_000 })
  await expect(page.getByRole("region", { name: "Conversa com o assistente" }).getByRole("alert")).toHaveCount(0)
  await expect(page.getByText("42.000000 UN", { exact: true }).first()).toBeVisible()
  await input.fill("Onde vejo os produtos?")
  await page.getByRole("button", { name: "Enviar", exact: true }).click()
  const conversation = page.getByRole("region", { name: "Conversa com o assistente" })
  await expect(conversation.getByRole("link", { name: "Produtos", exact: true })).toHaveAttribute("href", "/cadastros/produtos", { timeout: 105_000 })
  await expect(input).toBeEnabled({ timeout: 105_000 })
  await expect(conversation.getByRole("alert")).toHaveCount(0)
  await page.screenshot({ path: "test-results/assistant-real.png", fullPage: true })
  await page.getByRole("link", { name: "Parafuso de teste" }).last().click()
  await expect(page).toHaveURL(new RegExp(`/cadastros/produtos/${productId}$`))
})
