import { expect, test, type BrowserContext, type Page } from "@playwright/test"
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

async function prepare(context: BrowserContext) {
  await session(context)
  const company = await context.request.get("/api/erp/company")
  const current = await company.json()
  const updated = await context.request.put("/api/erp/company", { headers: { ...headers, "If-Match": company.headers().etag }, data: { ...current.data, stateRegistration: "718319130117" } })
  expect(updated.ok()).toBe(true)
  const profile = await context.request.get("/api/erp/fiscal/config")
  const saved = await context.request.put("/api/erp/fiscal/config", { headers: { ...headers, "If-Match": profile.headers().etag }, data: { environment: "homologation", state: "SP", municipalityCode: "3550308", stateRegistration: "718319130117", crt: 1, series: 1 } })
  expect(saved.ok()).toBe(true)
}

async function fill(page: Page, recipient: string) {
  await page.getByLabel("Natureza da operação", { exact: true }).fill("Venda — preparação de teste")
  await page.getByLabel("Referência da instrução fiscal").fill("FIXTURE DE TESTE — SEM APROVAÇÃO TRIBUTÁRIA")
  for (const [label, value] of [["CPF/CNPJ", "52998224725"], ["Nome ou razão social", recipient], ["Código IBGE do município", "3550308"], ["CEP", "01001000"], ["Logradouro", "Rua de teste"], ["Número", "1"], ["Bairro", "Centro"]]) await page.getByLabel(label, { exact: true }).fill(value)
  await page.getByLabel("UF do destinatário").selectOption("SP")
  for (const [label, value] of [["Código do produto", "TESTE-NFE"], ["Descrição do produto", "Produto de teste"], ["Unidade", "UN"], ["NCM", "00000000"], ["CFOP", "5102"], ["Quantidade", "3"], ["Preço unitário", "0,3333333333"], ["CST do PIS", "07"], ["CST da COFINS", "07"], ["CSOSN", "102"]]) await page.getByLabel(label, { exact: true }).fill(value)
  await page.getByLabel("Origem da mercadoria").selectOption("0")
}

test("NF-e de saída salva, recarrega, lista e preserva edição em conflito real", async ({ page, context }, info) => {
  await prepare(context)
  const recipient = `Destinatário ${randomUUID().slice(0, 8)}`
  await page.goto("/fiscal/notas-saida/nova")
  await expect(page.getByLabel("Natureza da operação", { exact: true })).toBeEnabled()
  await fill(page, recipient)
  await expect(page.getByText("Total bruto do item: R$ 1,00", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click()
  await expect(page).toHaveURL(/\/fiscal\/notas-saida\/[a-f0-9-]{36}$/)
  const id = new URL(page.url()).pathname.split("/").at(-1)
  await expect(page.getByLabel("Nome ou razão social", { exact: true })).toHaveValue(recipient)
  await page.reload()
  await expect(page.getByLabel("Nome ou razão social", { exact: true })).toHaveValue(recipient)
  const snapshot = await context.request.get(`/api/erp/fiscal/nfe/${id}`)
  const current = await snapshot.json()
  expect(current.data.productsTotal).toBe("1.00")
  expect(current.data.fiscalValidationComplete).toBe(false)
  expect(current.data.status).toBe("draft")
  await page.screenshot({ path: info.outputPath("rascunho-desktop.png"), fullPage: true })
  await page.getByLabel("Natureza da operação", { exact: true }).fill("Minha edição preservada")
  const external = await context.request.put(`/api/erp/fiscal/nfe/${id}`, { headers: { ...headers, "If-Match": snapshot.headers().etag }, data: { ...current.data.input, operationNature: "Alteração concorrente" } })
  expect(external.status()).toBe(200)
  await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Sua edição foi preservada" })).toBeVisible()
  await expect(page.getByLabel("Natureza da operação", { exact: true })).toHaveValue("Minha edição preservada")
  expect((await (await context.request.get(`/api/erp/fiscal/nfe/${id}`)).json()).data.input.operationNature).toBe("Alteração concorrente")
  page.once("dialog", dialog => dialog.accept())
  await page.getByRole("button", { name: "Recarregar dados do servidor" }).click()
  await expect(page.getByLabel("Natureza da operação", { exact: true })).toHaveValue("Alteração concorrente")
  await page.getByRole("link", { name: "Voltar aos rascunhos" }).click()
  await expect(page.getByRole("link", { name: recipient, exact: true })).toBeVisible()
  await expect(page.getByText("Academia Horizonte", { exact: true })).toHaveCount(0)
})

test("resposta perdida reutiliza o comando e produto é copiado sem presumir tributação", async ({ page, context }, info) => {
  await prepare(context)
  const recipient = `Recuperação ${randomUUID().slice(0, 8)}`
  const sku = `NFE-UI-${randomUUID().slice(0, 8)}`.toUpperCase()
  const product = await context.request.post("/api/erp/products", { headers: { ...headers, "Idempotency-Key": randomUUID() }, data: { sku, name: "Produto para rascunho", unit: "UN", ncm: "00000000", cest: null, basePrice: "10.00", status: "active" } })
  expect(product.status()).toBe(201)
  await page.goto("/fiscal/notas-saida/nova")
  await expect(page.getByLabel("Buscar produto por nome ou SKU")).toBeEnabled()
  await page.getByLabel("Buscar produto por nome ou SKU").fill(sku)
  await page.getByRole("button", { name: "Buscar produtos", exact: true }).click()
  await page.getByRole("button", { name: `Adicionar ${sku} — Produto para rascunho`, exact: true }).click()
  await expect(page.getByLabel("Código do produto", { exact: true })).toHaveValue(sku)
  await expect(page.getByLabel("Preço unitário", { exact: true })).toHaveValue("10.00")
  await expect(page.getByLabel("CFOP", { exact: true })).toHaveValue("")
  await expect(page.getByLabel("CSOSN", { exact: true })).toHaveValue("")
  await fill(page, recipient)
  const requests: { key: string; body: string | null }[] = []
  await page.route("**/api/erp/fiscal/nfe", async route => {
    if (route.request().method() !== "POST") return route.continue()
    requests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() })
    const response = await route.fetch()
    if (requests.length === 1) { expect(response.status()).toBe(201); return route.abort("connectionfailed") }
    await route.fulfill({ response })
  })
  await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click()
  await expect(page.getByRole("button", { name: "Confirmar mesma solicitação", exact: true })).toBeEnabled()
  await expect(page.getByLabel("Natureza da operação", { exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Confirmar mesma solicitação", exact: true }).click()
  await expect(page).toHaveURL(/\/fiscal\/notas-saida\/[a-f0-9-]{36}$/)
  expect(requests).toHaveLength(2)
  expect(requests[0]).toEqual(requests[1])
  const stored = await (await context.request.get("/api/erp/fiscal/nfe?limit=100")).json()
  expect(stored.tenantId).toBe(tenant)
  expect(stored.data.filter((item: { input: { recipient: { legalName: string } } }) => item.input.recipient.legalName === recipient)).toHaveLength(1)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath("rascunho-mobile.png"), fullPage: true })
})

test("conta sem permissão fiscal não recebe rascunhos nem pode criar", async ({ page, context }) => {
  await session(context, true)
  await page.goto("/fiscal/notas-saida")
  await expect(page.getByRole("alert").filter({ hasText: "Acesso não autorizado" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Preparar nota", exact: true })).toHaveCount(0)
  expect((await context.request.post("/api/erp/fiscal/nfe", { headers: { ...headers, "Idempotency-Key": randomUUID() }, data: {} })).status()).toBe(403)
  expect((await context.request.get("/api/erp/fiscal/nfe?unexpected=1")).status()).toBe(400)
})
