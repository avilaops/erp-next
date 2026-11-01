import { expect, test } from "@playwright/test"
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { companyFields } from "../src/features/company/company-types"

test.setTimeout(process.env.ERP_BROWSER_DEV === "1" ? 30000 : 10000)

const origin = "http://127.0.0.1:33118"
const secret = "danfe-browser-fixture-not-a-real-service-secret"
const tenant = "11111111-1111-4111-8111-111111111111"
let companyCount = 0
let denied = false
let commands: { key: string | undefined; body: string }[] = []
let upstreamCalls = 0
const upstream = createServer(async (request, response) => {
  upstreamCalls++
  expect(request.headers.authorization).toBe("Bearer onboarding-fixture-token")
  response.setHeader("Content-Type", "application/json")
  if (request.url === "/api/v1/companies") {
    expect(request.headers["x-tenant-id"]).toBeUndefined()
    if (request.method === "POST") {
      let body = ""; for await (const chunk of request) body += chunk
      commands.push({ key: request.headers["idempotency-key"] as string, body })
      if (commands.length === 1) { response.writeHead(503); response.end(JSON.stringify({ title: "Falha temporária" })); return }
      response.writeHead(201); response.end(JSON.stringify({ tenantId: tenant, revision: 1 })); return
    }
    response.end(JSON.stringify({ data: Array.from({ length: companyCount }, (_, index) => ({ id: index ? "22222222-2222-4222-8222-222222222222" : tenant, legalName: `Empresa ${index + 1}` })) })); return
  }
  if (request.url === "/api/v1/me") {
    response.writeHead(denied ? 403 : 200)
    response.end(JSON.stringify(denied ? { title: "Sem vínculo" } : { tenant: { id: tenant } })); return
  }
  response.writeHead(404); response.end("{}");
})
const issuer = "http://127.0.0.1:33120"
const auth = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json")
  if (request.url === "/.well-known/openid-configuration") {
    response.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, code_challenge_methods_supported: ["S256"] })); return
  }
  if (request.url === "/token") {
    response.end(JSON.stringify({ access_token: "onboarding-fixture-token", token_type: "Bearer", expires_in: 3600 })); return
  }
  response.writeHead(404); response.end("{}");
})
function cookie(tenantId: string | null = null, expiresAt = Date.now() + 3600_000) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "onboarding-fixture-token", tenantId, expiresAt })), cipher.final()])
  return { name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" as const }
}
function session(value: string) {
  const bytes = Buffer.from(value, "base64url")
  const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), bytes.subarray(0, 12))
  decipher.setAAD(Buffer.from("erp-session")); decipher.setAuthTag(bytes.subarray(12, 28))
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString())
}

test.beforeAll(async () => {
  await Promise.all([new Promise<void>(resolve => upstream.listen(33119, "127.0.0.1", resolve)), new Promise<void>(resolve => auth.listen(33120, "127.0.0.1", resolve))])
})
test.afterAll(async () => { await Promise.all([new Promise<void>(resolve => upstream.close(() => resolve())), new Promise<void>(resolve => auth.close(() => resolve()))]) })
test.beforeEach(() => { companyCount = 0; denied = false; commands = []; upstreamCalls = 0 })

test("entry keeps access visible and its single preview supports keyboard reading and closing", async ({ page }) => {
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 })
    await page.goto("/entrar?returnTo=%2Fcadastros%2Fprodutos%3Fstatus%3Dactive")
    await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole("link", { name: "Criar minha conta", exact: true })).toBeInViewport({ ratio: 1 })

    const trigger = page.getByRole("button", { name: "Ver tela completa do ERP", exact: true })
    await expect(trigger).toContainText("Ver tela completa")
    const thumbnail = trigger.locator("picture")
    await expect.poll(() => thumbnail.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
    const thumbnailBox = await thumbnail.locator("..").boundingBox()
    if (width < 640) expect(thumbnailBox!.height).toBeLessThanOrEqual(320)
    else expect(thumbnailBox!.height).toBeGreaterThan(320)
    await trigger.focus()
    await page.keyboard.press("Enter")
    const dialog = page.getByRole("dialog", { name: "Por dentro do Ávila ERP", exact: true })
    await expect(dialog).toBeVisible()
    const image = dialog.getByRole("img")
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
    await expect(image).toHaveCSS("opacity", "1")

    const capture = dialog.getByRole("region", { name: "Imagem ampliada do ERP", exact: true })
    await expect(dialog.getByRole("button")).toHaveCount(1)
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => new URL(element.currentSrc).pathname)).toBe(width < 640 ? "/erp-preview-mobile.png" : "/erp-preview.webp")
    await expect.poll(() => capture.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    const geometry = await capture.evaluate(element => {
      const image = element.querySelector("img")!
      const box = element.getBoundingClientRect()
      const picture = image.getBoundingClientRect()
      return { widthDifference: Math.abs(box.width - picture.width), topDifference: Math.abs(box.top - picture.top), naturalRatio: image.naturalWidth / image.naturalHeight, renderedRatio: picture.width / picture.height }
    })
    expect(geometry.widthDifference).toBeLessThanOrEqual(1)
    expect(geometry.topDifference).toBeLessThanOrEqual(1)
    expect(geometry.renderedRatio).toBeCloseTo(geometry.naturalRatio, 2)
    await capture.focus()
    if (width === 320) {
      await page.keyboard.press("ArrowDown")
      await expect.poll(() => capture.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    }

    const close = dialog.getByRole("button", { name: "Fechar prévia", exact: true })
    await close.focus()
    await page.keyboard.press("Tab")
    await expect(capture).toBeFocused()
    await page.keyboard.press("Tab")
    await expect(close).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    await trigger.click()
    await expect.poll(() => capture.evaluate(element => element.scrollTop)).toBe(0)
    await close.click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole("link", { name: "Criar minha conta", exact: true })).toHaveAttribute("href", "/criar-conta?returnTo=%2Fcadastros%2Fprodutos%3Fstatus%3Dactive")
  }
})

test("entry preview shows complete product data with margins in landscape and adapts when rotated", async ({ page }) => {
  for (const viewport of [{ width: 568, height: 320 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport)
    await page.goto("/entrar")
    await page.getByRole("button", { name: "Ver tela completa do ERP", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Por dentro do Ávila ERP", exact: true })
    const image = dialog.getByRole("img")
    await image.evaluate((image: HTMLImageElement) => image.decode())
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => new URL(element.currentSrc).pathname)).toBe("/erp-preview-landscape.png")
    const close = dialog.getByRole("button", { name: "Fechar prévia", exact: true })
    const capture = dialog.getByRole("region")
    await expect(close).toBeInViewport({ ratio: 1 })
    expect(await capture.evaluate(element => element.clientHeight)).toBeGreaterThan(viewport.height / 2)
    expect(await capture.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await image.evaluate(element => element.clientWidth)).toBeGreaterThan(viewport.width - 40)
    await expect.poll(() => capture.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true)
    const box = await dialog.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(15.5)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width - 15.5)
    await expect(image).toBeInViewport({ ratio: 1 })
    expect(await image.evaluate((element: HTMLImageElement) => [element.naturalWidth, element.naturalHeight])).toEqual([638, 208])

    await page.setViewportSize({ width: 390, height: 680 })
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => new URL(element.currentSrc).pathname)).toBe("/erp-preview-mobile.png")
    await image.evaluate((element: HTMLImageElement) => element.decode())
    await expect(dialog).toBeVisible()
    expect(await capture.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await expect(close).toBeInViewport({ ratio: 1 })
    await close.click()
  }
})

test("entry preview announces loading and recovers from a failed image without losing keyboard access", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 680 })
  let fail = false
  let releaseImage!: () => void
  const pending = new Promise<void>(resolve => { releaseImage = resolve })
  await page.route("**/erp-preview-mobile.png*", async route => {
    await pending
    if (fail) return route.abort("failed")
    return route.continue()
  })
  await page.goto("/entrar", { waitUntil: "domcontentloaded" })
  const trigger = page.getByRole("button", { name: "Ver tela completa do ERP", exact: true })
  await expect(trigger.getByRole("status")).toHaveText("Carregando prévia…")
  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeEnabled()
  await trigger.click()
  const dialog = page.getByRole("dialog", { name: "Por dentro do Ávila ERP", exact: true })
  await expect(dialog.getByRole("status")).toHaveText("Carregando prévia…")
  fail = true
  releaseImage()
  await expect(dialog.getByRole("alert")).toContainText("Não foi possível carregar a prévia.")
  await dialog.getByRole("button", { name: "Fechar prévia", exact: true }).click()
  await expect(trigger.getByRole("alert")).toContainText("Prévia indisponível.")
  expect(await trigger.locator("button").count()).toBe(0)
  await trigger.click()
  await expect(dialog.getByRole("alert")).toContainText("Não foi possível carregar a prévia.")
  const retry = dialog.getByRole("button", { name: "Tentar novamente", exact: true })
  await expect(retry).toBeInViewport({ ratio: 1 })
  await expect(dialog.getByRole("button", { name: "Fechar prévia", exact: true })).toBeInViewport({ ratio: 1 })
  fail = false
  await retry.focus()
  await page.keyboard.press("Enter")
  await expect(dialog.getByRole("region")).toBeFocused()
  await expect(dialog.getByRole("alert")).toHaveCount(0)
  const image = dialog.getByRole("img")
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(390)
  expect(await image.evaluate((element: HTMLImageElement) => new URL(element.currentSrc).searchParams.get("retry"))).toBe("1")
  await expect(dialog.getByRole("status")).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  await expect(trigger.getByRole("alert")).toHaveCount(0)
  await expect.poll(() => trigger.locator("img").evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(390)
})

test("a loaded preview reports a failed source after rotation and recovers when rotated back", async ({ page }) => {
  await page.route("**/erp-preview-landscape.png*", route => route.abort("failed"))
  await page.setViewportSize({ width: 390, height: 680 })
  await page.goto("/entrar")
  await page.getByRole("button", { name: "Ver tela completa do ERP", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Por dentro do Ávila ERP", exact: true })
  await expect.poll(() => dialog.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(390)
  await expect(dialog.getByRole("status")).toHaveCount(0)
  await page.setViewportSize({ width: 568, height: 320 })
  await expect(dialog.getByRole("alert")).toContainText("Não foi possível carregar a prévia.")
  await dialog.getByRole("button", { name: "Tentar novamente", exact: true }).focus()
  await page.setViewportSize({ width: 390, height: 680 })
  await expect(dialog.getByRole("alert")).toHaveCount(0)
  await expect.poll(() => dialog.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(390)
  await expect(dialog.getByRole("region")).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
})

test("OIDC without a company code routes zero, one and many companies after verified discovery", async ({ context }) => {
  for (const [count, destination] of [[0, "/cadastro/empresa"], [1, "/preferencias/empresa/dados"], [2, "/empresas"]] as const) {
    companyCount = count
    const login = await context.request.get("/api/auth/login", { maxRedirects: 0 })
    expect(login.status()).toBe(307)
    const location = new URL(login.headers().location)
    expect(location.searchParams.get("code_challenge_method")).toBe("S256")
    const callback = await context.request.get(`/api/auth/callback?code=fixture&state=${location.searchParams.get("state")}`, { maxRedirects: 0 })
    expect(callback.status()).toBe(307)
    expect(new URL(callback.headers().location).pathname).toBe(destination)
    const stored = (await context.cookies()).find(item => item.name === "erp_session")!
    expect(stored.httpOnly).toBe(true)
    expect(session(stored.value).tenantId).toBe(count === 1 ? tenant : null)
  }
})

test("identity-only sessions cannot access existing tenant data and company selection verifies access without extending expiry", async ({ context }) => {
  const expiresAt = Date.now() + 120_000
  await context.addCookies([cookie(null, expiresAt)])
  expect((await context.request.get("/api/erp/company")).status()).toBe(401)
  expect(upstreamCalls).toBe(0)
  const select = (headers = {}) => context.request.post("/api/auth/company", { headers: { Origin: origin, ...headers }, data: { tenantId: tenant } })
  expect((await select({ Origin: "https://foreign.invalid" })).status()).toBe(403)
  expect(upstreamCalls).toBe(0)
  denied = true
  expect((await select()).status()).toBe(403)
  expect(session((await context.cookies()).find(item => item.name === "erp_session")!.value).tenantId).toBeNull()
  denied = false
  expect((await select()).status()).toBe(200)
  const selected = session((await context.cookies()).find(item => item.name === "erp_session")!.value)
  expect(selected.tenantId).toBe(tenant)
  expect(selected.expiresAt).toBe(expiresAt)
})

test("cadastros distinguish a signed-out user from an authenticated user without a selected company", async ({ page, context }) => {
  await page.goto("/cadastros/produtos")
  await expect(page).toHaveURL(/\/entrar\?returnTo=%2Fcadastros%2Fprodutos$/)
  await expect(page.getByRole("heading", { name: "Sua operação, sob controle.", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Criar minha conta", exact: true })).toBeVisible()
  await context.addCookies([cookie()])
  for (const route of ["/cadastros/produtos/novo", "/cadastros/clientes-fornecedores", "/cadastros/vendedores", "/cadastros/formas-pagamento"]) {
    await page.goto(route)
    await expect(page.getByRole("status")).toContainText("Você já entrou. Selecione uma empresa")
    await expect(page.getByRole("link", { name: "Selecionar empresa", exact: true })).toHaveAttribute("href", "/empresas?" + new URLSearchParams({ returnTo: route }))
    await expect(page.getByRole("link", { name: "Cadastrar empresa", exact: true })).toHaveAttribute("href", "/cadastro/empresa")
    await expect(page.getByRole("link", { name: "Entrar com Ávila Ops", exact: true })).toHaveCount(0)
  }
  expect(upstreamCalls).toBe(0)
})

test("company signup keeps input and command key after an ambiguous failure, then selects the created company", async ({ page, context }) => {
  await context.addCookies([cookie()])
  await page.goto("/cadastro/empresa")
  for (const [label, value] of [["Nome empresarial", "Empresa de teste"], ["CPF ou CNPJ", "12ABC34501DE35"], ["CEP", "01001000"], ["Cidade", "São Paulo"], ["Rua", "Praça"], ["Número", "1"], ["Bairro", "Centro"]]) await page.getByLabel(label, { exact: true }).fill(value)
  await page.getByLabel("Regime tributário").selectOption("simples")
  await page.getByLabel("UF", { exact: true }).selectOption("SP")
  await page.getByLabel("Segmento", { exact: true }).selectOption("Serviços")
  await page.getByRole("button", { name: "Cadastrar empresa", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Falha temporária" })).toBeVisible()
  await expect(page.getByLabel("Nome empresarial", { exact: true })).toHaveValue("Empresa de teste")
  await page.getByRole("button", { name: "Cadastrar empresa", exact: true }).click()
  await page.waitForURL("**/preferencias/empresa/dados")
  expect(commands).toHaveLength(2)
  expect(commands[0]).toEqual(commands[1])
  expect(commands[0].key).toMatch(/^[0-9a-f-]{36}$/)
  expect(await page.content()).not.toContain("onboarding-fixture-token")
})

test("signup requires a session and picker exposes only the companies returned by the verified API", async ({ page, context }) => {
  await page.goto("/cadastro/empresa")
  await page.waitForURL("**/entrar?*")
  companyCount = 2
  await context.addCookies([cookie()])
  await page.goto("/empresas")
  await expect(page.getByRole("button", { name: "Empresa 1", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Empresa 2", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Empresa 1", exact: true }).click()
  await page.waitForURL("**/preferencias/empresa/dados")
  expect(session((await context.cookies()).find(item => item.name === "erp_session")!.value).tenantId).toBe(tenant)
})

test("expired access preserves the internal path and filters through the login form", async ({ page, context }) => {
  await context.addCookies([cookie(tenant, Date.now() - 1000)])
  const destination = "/cadastros/produtos?status=archived&offset=25"
  await page.goto(destination)
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe(destination)
  await expect(page.locator('form[action="/api/auth/login"] input[name="returnTo"]')).toHaveValue(destination)
})

test("expired company selection retains the original destination during recovery", async ({ page, context }) => {
  const destination = "/cadastros/produtos?status=archived"
  for (const path of ["/empresas", "/cadastro/empresa"]) {
    await context.clearCookies()
    await page.goto(path + "?" + new URLSearchParams({ returnTo: destination }))
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe(destination)
  }
  await context.addCookies([cookie(tenant)])
  await page.route("**/api/erp/companies", route => route.fulfill({ status: 401, json: { title: "Sessão expirada" } }))
  await page.goto("/empresas?" + new URLSearchParams({ returnTo: destination }))
  await expect(page.locator("main").getByRole("link", { name: "Entrar com Ávila Ops", exact: true })).toHaveAttribute("href", "/entrar?" + new URLSearchParams({ returnTo: destination }))
})

test("OIDC returns to the sealed destination and ignores callback redirect parameters", async ({ context }) => {
  companyCount = 1
  const destination = "/cadastros/produtos?status=archived&offset=25"
  const login = await context.request.get("/api/auth/login?" + new URLSearchParams({ returnTo: destination }), { maxRedirects: 0 })
  const state = new URL(login.headers().location).searchParams.get("state")!
  const callback = await context.request.get("/api/auth/callback?" + new URLSearchParams({ code: "fixture", state, returnTo: "//foreign.invalid" }), { maxRedirects: 0 })
  expect(callback.status()).toBe(307)
  expect(callback.headers().location).toBe(origin + destination)
})

test("OIDC rejects external, encoded, API and looping return destinations", async ({ context }) => {
  companyCount = 1
  for (const returnTo of ["https://foreign.invalid", "//foreign.invalid", "/\\foreign.invalid", "/%2f%2fforeign.invalid", "/%255cforeign.invalid", "/api/auth/logout", "/entrar", "/empresas", "/cadastro/empresa", "/%0aevil", "/%E0%A4%A", "/" + "é".repeat(400)]) {
    const login = await context.request.get("/api/auth/login?" + new URLSearchParams({ returnTo }), { maxRedirects: 0 })
    const state = new URL(login.headers().location).searchParams.get("state")!
    const callback = await context.request.get("/api/auth/callback?" + new URLSearchParams({ code: "fixture", state }), { maxRedirects: 0 })
    expect(callback.status()).toBe(307)
    expect(callback.headers().location).toBe(origin + "/preferencias/empresa/dados")
  }
})

test("multiple companies keep the requested destination until verified selection", async ({ page, context }) => {
  companyCount = 2
  const destination = "/cadastros/produtos?status=archived"
  const login = await context.request.get("/api/auth/login?" + new URLSearchParams({ returnTo: destination }), { maxRedirects: 0 })
  const state = new URL(login.headers().location).searchParams.get("state")!
  const callback = await context.request.get("/api/auth/callback?" + new URLSearchParams({ code: "fixture", state }), { maxRedirects: 0 })
  const picker = new URL(callback.headers().location)
  expect(picker.pathname).toBe("/empresas")
  expect(picker.searchParams.get("returnTo")).toBe(destination)
  await page.route("**/api/erp/products?*", route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: [], total: 0 } }))
  await page.goto(picker.href)
  await page.getByRole("button", { name: "Empresa 2", exact: true }).click()
  await expect(page).toHaveURL(origin + destination)
  expect(session((await context.cookies()).find(item => item.name === "erp_session")!.value).tenantId).toBe("22222222-2222-4222-8222-222222222222")
})

test("401 offers contextual login while 503 remains retryable and company switch opens picker", async ({ page, context }) => {
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await context.addCookies([cookie(tenant)])
  await page.route("**/api/erp/product-categories?*", route => route.fulfill({ status: 401, json: { title: "Sessão expirada" } }))
  await page.goto("/cadastros/categorias-produtos")
  await expect(page.locator("main").getByRole("link", { name: "Entrar com Ávila Ops", exact: true })).toHaveAttribute("href", "/entrar?" + new URLSearchParams({ returnTo: "/cadastros/categorias-produtos" }))
  let unavailable = true
  await page.route("**/api/erp/company", route => route.fulfill({ status: unavailable ? 503 : 200, json: unavailable ? { title: "Consulta temporariamente indisponível" } : { tenantId: tenant, revision: 1, canEdit: true, data: { ...Object.fromEntries(companyFields.map(field => [field, ""])), legalName: "Empresa de teste", tradeName: "", taxId: "11222333000181", segments: [], substituteRegistrations: [] } } }))
  await page.goto("/preferencias/empresa")
  await expect(page.getByText("Consulta temporariamente indisponível", { exact: true })).toBeVisible()
  await expect(page.locator("main").getByRole("link", { name: "Entrar com Ávila Ops", exact: true })).toHaveCount(0)
  unavailable = false
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click()
  await expect(page.getByRole("link", { name: "Trocar empresa", exact: true })).toHaveAttribute("href", "/empresas?" + new URLSearchParams({ returnTo: "/preferencias/empresa" }))
  expect(errors).toEqual([])
})
