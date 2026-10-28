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

async function product(context: BrowserContext, name: string) {
  const response = await context.request.post("/api/erp/products", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: { sku: randomUUID(), name, unit: "UN", basePrice: "0.10", ncm: null, cest: null, status: "active" },
  })
  expect(response.status()).toBe(201)
  return (await response.json()).data.id as string
}

test("estoque confirma entrada, recusa saldo negativo e estorna com histórico persistido", async ({ page, context }) => {
  await session(context)
  const name = "Parafuso de estoque persistido"
  const id = await product(context, name)
  await page.setViewportSize({ width: 375, height: 844 })
  await page.goto("/estoque/saldos")
  await page.getByRole("button", { name: new RegExp(`^${name} SKU `) }).click()
  const quantity = page.getByRole("textbox", { name: "Quantidade (ponto decimal)", exact: true })
  const reason = page.getByRole("textbox", { name: "Motivo", exact: true })
  await quantity.fill("10.000001")
  await reason.fill("Contagem inicial conferida")
  await page.getByRole("button", { name: "Confirmar lançamento", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Saldo após o lançamento: 10.000001" })).toBeVisible()
  await page.getByRole("combobox", { name: "Direção", exact: true }).selectOption("issue")
  await quantity.fill("11")
  await reason.fill("Tentativa de saída superior ao saldo")
  await page.getByRole("button", { name: "Confirmar lançamento", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Saldo insuficiente" })).toBeVisible()
  await expect(quantity).toHaveValue("11")
  await quantity.fill("2.000001")
  await reason.fill("Separação de material")
  await page.getByRole("button", { name: "Confirmar lançamento", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Saldo após o lançamento: 8.000000" })).toBeVisible()
  await page.getByRole("button", { name: "Preparar estorno de 2.000001", exact: true }).click()
  await expect(quantity).toHaveValue("2.000001")
  await expect(quantity).toBeDisabled()
  await reason.fill("Cancelamento da separação")
  await page.getByRole("button", { name: "Confirmar estorno", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Saldo após o lançamento: 10.000001" })).toBeVisible()
  await page.reload()
  await page.getByRole("button", { name: new RegExp(`^${name} SKU `) }).click()
  await expect(page.getByText("Cancelamento da separação", { exact: true })).toBeVisible()
  const history = await context.request.get(`/api/erp/stock/movements?productId=${id}`)
  expect((await history.json()).total).toBe(3)
  await page.getByRole("button", { name: "Preparar estorno de 2.000001", exact: true }).click()
  await reason.fill("Segunda tentativa do mesmo estorno")
  await page.getByRole("button", { name: "Confirmar estorno", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Movimento já estornado" })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const nextPage = await page.getByRole("button", { name: "Próximos movimentos", exact: true }).boundingBox()
  const navigation = await page.getByRole("navigation", { name: "Navegação móvel", exact: true }).boundingBox()
  expect(nextPage).not.toBeNull()
  expect(navigation).not.toBeNull()
  expect(nextPage!.y + nextPage!.height).toBeLessThanOrEqual(navigation!.y)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: "../../evidencias/screenshots/erp-estoque-mobile-persistente.png", fullPage: true })
})

test("resposta perdida repete a mesma chave sem duplicar o movimento", async ({ page, context }) => {
  await session(context)
  const name = "Produto de confirmação interrompida"
  const id = await product(context, name)
  await page.goto("/estoque/lancamentos/novo")
  await page.getByRole("button", { name: new RegExp(`^${name} SKU `) }).click()
  await page.getByRole("textbox", { name: "Quantidade (ponto decimal)", exact: true }).fill("3.000001")
  await page.getByRole("textbox", { name: "Motivo", exact: true }).fill("Entrada com resposta interrompida")
  let lost = false
  const keys: string[] = []
  await page.route("**/api/erp/stock/movements", async route => {
    if (route.request().method() !== "POST") return route.continue()
    keys.push(route.request().headers()["idempotency-key"])
    if (!lost) {
      const committed = await route.fetch()
      expect(committed.status()).toBe(201)
      lost = true
      return route.abort("failed")
    }
    return route.continue()
  })
  await page.getByRole("button", { name: "Confirmar lançamento", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Motivo", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Repetir confirmação", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Saldo após o lançamento: 3.000001" })).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBe(keys[1])
  const history = await context.request.get(`/api/erp/stock/movements?productId=${id}`)
  expect((await history.json()).total).toBe(1)
})

test("estoque respeita consulta e cabe no celular", async ({ page, context }) => {
  await session(context)
  const name = "Consulta de estoque no celular"
  await product(context, name)
  await session(context, true)
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto("/estoque")
  await page.getByRole("button", { name: new RegExp(`^${name} SKU `) }).click()
  await expect(page.getByText("Somente consulta. Você não pode movimentar o estoque.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Confirmar lançamento", exact: true })).toHaveCount(0)
  expect((await context.request.post("/api/erp/stock/movements", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: { productId: randomUUID(), direction: "receipt", quantity: "1", reason: "Tentativa sem direito", reversesId: null },
  })).status()).toBe(403)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})
