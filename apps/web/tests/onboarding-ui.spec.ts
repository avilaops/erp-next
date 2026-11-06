import { expect, test } from "@playwright/test"
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"
import axe from "axe-core"
import { companyFields } from "../src/features/company/company-types"

test.setTimeout(process.env.ERP_BROWSER_DEV === "1" ? 30000 : 10000)

const origin = "http://127.0.0.1:33118"
const secret = "danfe-browser-fixture-not-a-real-service-secret"
const tenant = "11111111-1111-4111-8111-111111111111"
let companyCount = 0
let platformAdministrator = false
let suspendedCompany = false
let denied = false
let selectionDelayMs = 0
let selectionStatus = 204
let commands: { key: string | undefined; body: string }[] = []
let upstreamCalls = 0
let redirectAuthorization = false
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
    response.end(JSON.stringify({ platformAdministrator, data: Array.from({ length: companyCount }, (_, index) => ({ id: index ? "22222222-2222-4222-8222-222222222222" : tenant, legalName: `Empresa ${index + 1}`, status: suspendedCompany && index === 1 ? "suspended" : "active" })) })); return
  }
  if (request.url === "/api/v1/company-selection") {
    expect(request.method).toBe("POST")
    if (selectionDelayMs) await new Promise(resolve => setTimeout(resolve, selectionDelayMs))
    response.writeHead(denied ? 403 : selectionStatus); response.end(); return
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
  const authorization = new URL(request.url || "/", issuer)
  if (redirectAuthorization && authorization.pathname === "/authorize") {
    const callback = new URL("/api/auth/callback", origin)
    callback.search = new URLSearchParams({ code: "fixture", state: authorization.searchParams.get("state") || "" }).toString()
    response.writeHead(302, { Location: callback.href }); response.end(); return
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
test.beforeEach(() => { companyCount = 0; platformAdministrator = false; suspendedCompany = false; denied = false; selectionDelayMs = 0; selectionStatus = 204; commands = []; upstreamCalls = 0; redirectAuthorization = false })

for (const requestedTenant of ["", tenant]) test(`platform administrator must choose even a single company after login with tenant ${requestedTenant || "omitted"}`, async ({ page, context }) => {
  companyCount = 1; platformAdministrator = true; redirectAuthorization = true
  const destination = "/preferencias?categoria=vendas"
  await page.goto("/api/auth/login?" + new URLSearchParams({ returnTo: destination, tenant: requestedTenant }))
  await expect(page).toHaveURL(url => url.pathname === "/empresas")
  await expect(page.getByText("Administração da plataforma", { exact: false })).toBeVisible()
  const initial = (await context.cookies()).find(item => item.name === "erp_session")!
  expect(session(initial.value).tenantId).toBeNull()
  await page.getByRole("button", { name: "Empresa 1", exact: true }).click()
  await expect(page).toHaveURL(origin + destination)
  const selected = (await context.cookies()).find(item => item.name === "erp_session")!
  expect(session(selected.value).tenantId).toBe(tenant)
})

test("platform directory shows but disables suspended companies", async ({ page, context }) => {
  companyCount = 2; platformAdministrator = true; suspendedCompany = true
  await context.addCookies([cookie()])
  await page.goto("/empresas")
  await expect(page.getByRole("button", { name: /Empresa 2/ })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Empresa 1", exact: true })).toBeEnabled()
})

test("company picker identifies the pending company and recovers from denied selection", async ({ page, context }) => {
  companyCount = 2; platformAdministrator = true; selectionDelayMs = 250
  await context.addCookies([cookie()])
  await page.goto("/empresas")
  const first = page.getByRole("button", { name: "Empresa 1", exact: true })
  const second = page.getByRole("button", { name: /Empresa 2/ })
  await second.click()
  await expect(page.getByRole("status")).toHaveText("Acessando Empresa 2…")
  await expect(second).toContainText("Acessando…")
  await expect(first).toBeDisabled()
  await expect(second).toBeDisabled()
  await expect(page).toHaveURL(origin + "/preferencias/empresa/dados")

  await context.addCookies([cookie()])
  denied = true; selectionDelayMs = 0
  await page.goto("/empresas")
  await first.click()
  await expect(page.locator("#company-picker-feedback")).toHaveText("Seu acesso a esta empresa não foi autorizado.")
  await expect(first).toBeEnabled()
  await expect(second).toBeEnabled()

  denied = false; selectionStatus = 503
  await second.click()
  await expect(page.locator("#company-picker-feedback")).toHaveText("O serviço de empresas está temporariamente indisponível. Tente novamente.")
  await expect(first).toBeEnabled()
  await expect(second).toBeEnabled()
})

for (const error of ["", "restart"]) test(`entry login reaches Auth from ${error || "normal access"} under the same-origin form policy and preserves its return path`, async ({ page, context }) => {
  const destination = "/cadastros/produtos?status=active&offset=25"
  const entry = await page.goto("/entrar?" + new URLSearchParams({ returnTo: destination, erro: error }))
  expect(entry!.headers()["content-security-policy"]).toContain("form-action 'self'")
  await page.getByText("Entrar", { exact: true }).click()
  await expect(page).toHaveURL(url => url.origin === issuer && url.pathname === "/authorize")
  const authorization = new URL(page.url())
  expect(authorization.searchParams.get("code_challenge_method")).toBe("S256")
  expect(authorization.searchParams.get("redirect_uri")).toBe(`${origin}/api/auth/callback`)
  const callback = await context.request.get(`${origin}/api/auth/callback?` + new URLSearchParams({ code: "fixture", state: authorization.searchParams.get("state")! }), { maxRedirects: 0 })
  expect(callback.status()).toBe(307)
  expect(new URL(callback.headers().location).pathname).toBe("/cadastro/empresa")
  expect(new URL(callback.headers().location).searchParams.get("returnTo")).toBe(destination)
})

for (const error of ["", "restart"]) test(`entry login completes the browser callback from ${error || "normal access"} and returns to sales preferences`, async ({ page }) => {
  companyCount = 1
  redirectAuthorization = true
  const destination = "/preferencias?categoria=vendas"
  const response = await page.goto("/entrar?" + new URLSearchParams({ returnTo: destination, erro: error }))
  expect(response!.headers()["content-security-policy"]).toContain("form-action 'self'")
  const authorizations: URL[] = []
  page.on("request", request => {
    const url = new URL(request.url())
    if (url.origin === issuer && url.pathname === "/authorize") authorizations.push(url)
  })
  await page.getByRole("link", { name: "Entrar", exact: true }).click()
  await expect(page).toHaveURL(origin + destination)
  expect(authorizations).toHaveLength(1)
  expect(authorizations[0].searchParams.get("code_challenge_method")).toBe("S256")
  expect(authorizations[0].searchParams.get("redirect_uri")).toBe(origin + "/api/auth/callback")
  await expect(page.getByRole("heading", { name: "Preferências", exact: true })).toBeVisible()
})

test("entry offers persistent light, dark and system themes with readable text", async ({ page }, info) => {
  test.setTimeout(60_000)
  await page.goto("/entrar")
  const theme = page.getByRole("combobox", { name: "Tema", exact: true })
  await expect(theme).toBeVisible()
  for (const value of ["dark", "light"] as const) {
    await theme.selectOption(value)
    await expect.poll(() => page.locator("html").evaluate(element => element.classList.contains("dark"))).toBe(value === "dark")
    await page.reload()
    await expect(theme).toHaveValue(value)
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 568, height: 320 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport)
      await expect(page.getByRole("link", { name: "Entrar", exact: true })).toBeInViewport({ ratio: 1 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(await page.locator("#acesso > p").evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14)
      await page.addScriptTag({ content: axe.source })
      const result = await page.evaluate(async () => (window as unknown as { axe: typeof axe }).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } }))
      expect(result.violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) }))).toEqual([])
      await page.screenshot({ path: info.outputPath(`entrada-${value}-${viewport.width}x${viewport.height}.png`), fullPage: true })
    }
  }
  await theme.selectOption("system")
  await page.emulateMedia({ colorScheme: "dark" })
  await expect.poll(() => page.locator("html").evaluate(element => element.classList.contains("dark"))).toBe(true)
  await page.emulateMedia({ colorScheme: "light" })
  await expect.poll(() => page.locator("html").evaluate(element => element.classList.contains("dark"))).toBe(false)
})

test("entry keeps access visible and its single preview supports keyboard reading and closing", async ({ page }) => {
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 })
    await page.goto("/entrar?returnTo=%2Fcadastros%2Fprodutos%3Fstatus%3Dactive")
    await expect(page.getByRole("link", { name: "Entrar", exact: true })).toBeInViewport({ ratio: 1 })
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

test("entry recovery keeps the error and access controls together in the first phone viewport", async ({ page }) => {
  const destination = "/cadastros/produtos?status=active"
  for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }]) {
    await page.setViewportSize(viewport)
    for (const error of ["restart", "denied", "unavailable"]) {
      await page.goto("/entrar?" + new URLSearchParams({ erro: error, returnTo: destination }))
      await expect(page.getByRole("heading", { name: "Retome o acesso", exact: true })).toBeVisible()
      const alert = page.locator("main").getByRole("alert")
      await expect(alert).toBeInViewport({ ratio: 1 })
      const login = page.getByRole("link", { name: "Entrar", exact: true })
      await expect(login).toBeInViewport({ ratio: 1 })
      await expect(login).toHaveAttribute("aria-describedby", "access-error")
      await expect(page.getByRole("link", { name: "Criar minha conta", exact: true })).toBeInViewport({ ratio: 1 })
      await expect(login).toHaveAttribute("href", "/api/auth/login?" + new URLSearchParams({ returnTo: destination }))
    }
  }
})

test("entry preview shows complete product data with margins in landscape and adapts when rotated", async ({ page }) => {
  for (const viewport of [{ width: 568, height: 320 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport)
    await page.goto("/entrar")
    await expect(page.getByRole("link", { name: "Entrar", exact: true })).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole("link", { name: "Criar minha conta", exact: true })).toBeInViewport({ ratio: 1 })
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
  await expect(page.getByRole("link", { name: "Entrar", exact: true })).toBeEnabled()
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
  await expect.poll(() => trigger.locator("picture img").evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(390)
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

test("company selection rejects non-JSON and malformed bodies before forwarding tenant input", async ({ context }) => {
  await context.addCookies([cookie(null)])
  const nonJson = await context.request.post("/api/auth/company", { headers: { Origin: origin, "Content-Type": "text/plain" }, data: JSON.stringify({ tenantId: tenant }) })
  expect(nonJson.status()).toBe(415)
  expect(await nonJson.json()).toEqual({ title: "O pedido precisa ser JSON" })

  const malformed = await context.request.post("/api/auth/company", { headers: { Origin: origin, "Content-Type": "application/json" }, data: "{" })
  expect(malformed.status()).toBe(400)
  expect(await malformed.json()).toEqual({ title: "Pedido inválido" })
  expect(upstreamCalls).toBe(0)
})

test("cadastros distinguish a signed-out user from an authenticated user without a selected company", async ({ page, context }) => {
  await page.goto("/cadastros/produtos")
  await expect(page).toHaveURL(/\/entrar\?returnTo=%2Fcadastros%2Fprodutos$/)
  await expect(page.getByRole("heading", { name: "Sua operação, sob controle.", exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Entrar", exact: true })).toBeVisible()
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

test("company signup exposes selection expiration after creation and keeps the created company recoverable", async ({ page, context }) => {
  await context.addCookies([cookie()])
  await page.goto("/cadastro/empresa")
  for (const [label, value] of [["Nome empresarial", "Empresa de seleção"], ["CPF ou CNPJ", "12ABC34501DE35"], ["CEP", "01001000"], ["Cidade", "São Paulo"], ["Rua", "Praça"], ["Número", "1"], ["Bairro", "Centro"]]) await page.getByLabel(label, { exact: true }).fill(value)
  await page.getByLabel("Regime tributário").selectOption("simples")
  await page.getByLabel("UF", { exact: true }).selectOption("SP")
  await page.getByLabel("Segmento", { exact: true }).selectOption("Serviços")
  await page.route("**/api/auth/company", async route => route.fulfill({ status: 401, json: { title: "Entre novamente" } }))
  await page.getByRole("button", { name: "Cadastrar empresa", exact: true }).click()
  await expect(page.getByRole("status")).toContainText("Sua sessão expirou. Entre novamente para continuar.")
  await expect(page.getByRole("button", { name: "Acessar empresa cadastrada", exact: true })).toBeVisible()
  await page.unroute("**/api/auth/company")
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

test("company picker distinguishes an unavailable company service from an expired session", async ({ page, context }) => {
  await context.addCookies([cookie(null)])
  await page.route("**/api/erp/companies", route => route.fulfill({ status: 503, json: { title: "Consulta indisponível" } }))
  await page.goto("/empresas")
  await expect(page.getByRole("alert")).toHaveText("O serviço de empresas está temporariamente indisponível. Tente novamente.")
  await page.unroute("**/api/erp/companies")
})

test("company picker does not open a page when the selected tenant is not confirmed", async ({ page, context }) => {
  companyCount = 1
  await context.addCookies([cookie(null)])
  await page.route("**/api/auth/company", route => route.fulfill({ status: 200, json: { tenantId: "22222222-2222-4222-8222-222222222222" } }))
  await page.goto("/empresas")
  await page.getByRole("button", { name: "Empresa 1", exact: true }).click()
  await expect(page.getByRole("alert")).toHaveText("A empresa selecionada não foi confirmada. Atualize a lista e tente novamente.")
  await page.unroute("**/api/auth/company")
})

test("expired access preserves the internal path and filters through the login form", async ({ page, context }) => {
  await context.addCookies([cookie(tenant, Date.now() - 1000)])
  const destination = "/cadastros/produtos?status=archived&offset=25"
  await page.goto(destination)
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe(destination)
  await expect(page.getByRole("link", { name: "Entrar", exact: true })).toHaveAttribute("href", "/api/auth/login?" + new URLSearchParams({ returnTo: destination }))
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
