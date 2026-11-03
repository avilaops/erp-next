import { expect, test } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { origin, secret, server } from "../playwright.session.config"

test.afterEach(async ({ page }) => {
  // Asset requests may still be in flight when the assertions finish.
  await page.unrouteAll({ behavior: "ignoreErrors" })
})

test.beforeEach(async ({ context, page }) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "cookie-fixture-token", tenantId: null, expiresAt: Date.now() + 3600_000 })), cipher.final()])
  const session = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url")
  await context.addCookies(["session", "auth"].map(purpose => ({ name: `__Host-erp_${purpose}`, value: purpose === "session" ? session : "invalid-auth-fixture", url: origin, secure: true, httpOnly: true, sameSite: "Lax" as const })))
  // Keep the browser on an HTTPS origin so it enforces __Host- cookie rules.
  // Only transport is local; response cookies come from the real Next handlers.
  await page.route(`${origin}/**`, async route => {
    const requested = new URL(route.request().url())
    if (requested.pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Session cookie verification</title>" })
    const response = await route.fetch({ url: `${server}${requested.pathname}${requested.search}`, maxRedirects: 0 })
    await route.fulfill({ response })
  })
  await page.goto(`${origin}/fixture`)
})

test("logout removes both secure cookies and rejects the next protected API request", async ({ page, context }) => {
  const responseType = await page.evaluate(async () => (await fetch("/api/auth/logout", { method: "POST", redirect: "manual" })).type)
  expect(responseType).toBe("opaqueredirect")
  expect((await context.cookies(origin)).filter(cookie => ["__Host-erp_session", "__Host-erp_auth"].includes(cookie.name))).toEqual([])
  const status = await page.evaluate(async () => (await fetch("/api/erp/me")).status)
  expect(status).toBe(401)
})

test("invalid callback consumes its secure flow cookie without deleting the session", async ({ page, context }) => {
  const status = await page.evaluate(async () => (await fetch("/api/auth/callback?state=invalid&code=invalid")).status)
  expect(status).toBe(400)
  const names = (await context.cookies(origin)).map(cookie => cookie.name)
  expect(names).not.toContain("__Host-erp_auth")
  expect(names).toContain("__Host-erp_session")
})

test("browser callback failure offers a clean restart without exposing authentication parameters", async ({ page, context }) => {
  const response = await context.request.get(`${server}/api/auth/callback?state=invalid&code=secret-code&returnTo=https://evil.test`, { maxRedirects: 0, headers: { Accept: "text/html" } })
  expect(response.status()).toBe(303)
  const destination = new URL(response.headers().location)
  expect(destination.origin).toBe(origin)
  expect(destination.pathname).toBe("/entrar")
  expect(destination.searchParams.get("erro")).toBe("restart")
  expect(destination.href).not.toContain("secret-code")
  expect(destination.href).not.toContain("evil.test")
  expect(response.headers()["referrer-policy"]).toBe("no-referrer")
  // The public HTTPS hostname is synthetic. Follow the verified Location via
  // the local transport to render the real entry page without external DNS.
  await page.goto(`${server}${destination.pathname}${destination.search}`)
  await expect(page.getByRole("main").getByRole("alert")).toContainText("outro navegador")
  await expect(page.getByRole("link", { name: "Entrar", exact: true })).toBeVisible()
  expect(response.headers()["set-cookie"]).toContain("__Host-erp_auth=;")
  expect(response.headers()["set-cookie"]).not.toContain("__Host-erp_session")
})

test("expired flow keeps its validated destination for a new attempt", async ({ page, context }, testInfo) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-auth"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ state: "expired", verifier: "verifier", tenantId: null, returnTo: "/cadastros/produtos?pagina=2", expiresAt: Date.now() - 1000 })), cipher.final()])
  const flow = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url")
  const response = await context.request.get(`${server}/api/auth/callback?state=expired&code=expired-code`, { maxRedirects: 0, headers: { Accept: "text/html", Cookie: `__Host-erp_auth=${flow}` } })
  expect(response.status()).toBe(303)
  const destination = new URL(response.headers().location)
  expect(destination.searchParams.get("returnTo")).toBe("/cadastros/produtos?pagina=2")
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`${server}${destination.pathname}${destination.search}`)
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible()
    await expect(page.getByRole("link", { name: "Entrar", exact: true })).toHaveAttribute("href", "/api/auth/login?" + new URLSearchParams({ returnTo: "/cadastros/produtos?pagina=2" }))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole("link", { name: "Entrar", exact: true }).focus()
    await expect(page.getByRole("link", { name: "Entrar", exact: true })).toBeFocused()
    await page.screenshot({ path: testInfo.outputPath(`reiniciar-acesso-${width}.png`), fullPage: true, caret: "initial" })
  }
})

test("logout rejects an absent origin without changing either cookie", async ({ context }) => {
  const response = await context.request.post(`${server}/api/auth/logout`, { maxRedirects: 0 })
  expect(response.status()).toBe(403)
  expect((await context.cookies(origin)).filter(cookie => cookie.name.startsWith("__Host-erp_"))).toHaveLength(2)
})

test("botão Sair preserva a origem e inicia a continuação central", async ({ page, context }) => {
  await page.route(`${origin}/api/auth/logout/central`, route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Continuação da saída</title>" }))
  await page.goto(`${origin}/preferencias`)
  const request = page.waitForRequest(request => request.url() === `${origin}/api/auth/logout`)
  await page.getByRole("button", { name: "Sair", exact: true }).click()
  expect((await request).headers().origin).toBe(origin)
  await expect(page).toHaveURL(`${origin}/api/auth/logout/central`)
  expect((await context.cookies(origin)).filter(cookie => ["__Host-erp_session", "__Host-erp_auth"].includes(cookie.name))).toHaveLength(0)
  expect((await context.cookies(origin)).some(cookie => cookie.name === "__Host-erp_logout")).toBe(true)
})

test("falha na saída permanece na interface e permite tentar novamente", async ({ page, context }) => {
  await page.goto(`${origin}/preferencias`)
  await page.route(`${origin}/api/auth/logout`, route => route.fulfill({ status: 403, json: { title: "Origem não autorizada" } }))
  await page.getByRole("button", { name: "Sair", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "A saída foi recusada" })).toBeVisible()
  await expect(page).toHaveURL(`${origin}/preferencias`)
  await expect(page.getByRole("button", { name: "Sair", exact: true })).toBeEnabled()
  expect((await context.cookies(origin)).filter(cookie => cookie.name.startsWith("__Host-erp_"))).toHaveLength(2)
})

test("falha de rede na saída preserva a tela e permite nova tentativa", async ({ page, context }) => {
  await page.goto(`${origin}/preferencias`)
  await page.route(`${origin}/api/auth/logout`, route => route.abort("failed"))
  await page.getByRole("button", { name: "Sair", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Não foi possível confirmar a saída" })).toBeVisible()
  await expect(page).toHaveURL(`${origin}/preferencias`)
  await expect(page.getByRole("button", { name: "Sair", exact: true })).toBeEnabled()
  expect((await context.cookies(origin)).filter(cookie => cookie.name.startsWith("__Host-erp_"))).toHaveLength(2)
})

test("a navegação POST com no-referrer perde a origem, mas fetch conserva a origem", async ({ page, context }) => {
  await page.route(`${origin}/logout-form`, route => route.fulfill({ headers: { "Referrer-Policy": "no-referrer" }, contentType: "text/html", body: '<form method="post" action="/api/auth/logout"><button>Sair da fixture</button></form>' }))
  await page.goto(`${origin}/logout-form`)
  const navigation = page.waitForRequest(request => request.url() === `${origin}/api/auth/logout`)
  await page.getByRole("button", { name: "Sair da fixture" }).click()
  expect((await navigation).headers().origin).toBe("null")
  await expect(page.locator("body")).toContainText("Origem não autorizada")
  expect((await context.cookies(origin)).filter(cookie => cookie.name.startsWith("__Host-erp_"))).toHaveLength(2)
  await page.goto(`${origin}/logout-form`)
  const responseType = await page.evaluate(async () => (await fetch("/api/auth/logout", { method: "POST", redirect: "manual" })).type)
  expect(responseType).toBe("opaqueredirect")
  expect((await context.cookies(origin)).filter(cookie => ["__Host-erp_session", "__Host-erp_auth"].includes(cookie.name))).toHaveLength(0)
})

test("responses enforce the browser security policy without disclosing the framework", async ({ context }) => {
  const response = await context.request.get(`${server}/entrar`, { maxRedirects: 0 })
  expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'none'")
  expect(response.headers()["content-security-policy"]).toContain("frame-src 'self' blob:")
  expect(response.headers()["content-security-policy"]).toContain("connect-src 'self' blob: data:")
  expect(response.headers()["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains")
  expect(response.headers()["x-content-type-options"]).toBe("nosniff")
  expect(response.headers()["x-frame-options"]).toBe("DENY")
  expect(response.headers()["x-powered-by"]).toBeUndefined()
})

test("image optimizer rejects malformed local paths before processing them", async ({ context }) => {
  const response = await context.request.get(`${server}/_next/image?url=${encodeURIComponent("/erp-preview.webp'")}&w=1080&q=75`)
  expect(response.status()).toBe(400)
  await expect(response.json()).resolves.toEqual({ title: "Parâmetro de imagem inválido" })
})

for (const path of ["/api/auth/logout/central", "/api/auth/logout/central/callback"]) {
  test(`direct GET ${path} preserves the session without a verified logout flow`, async ({ page, context }) => {
    const response = await page.evaluate(async path => {
      const response = await fetch(path, { redirect: "manual" })
      return { status: response.status, type: response.type }
    }, path)
    expect(response).toEqual({ status: 403, type: "basic" })
    expect((await context.cookies(origin)).map(cookie => cookie.name).sort()).toEqual(["__Host-erp_auth", "__Host-erp_session"])
  })
}

test("stored contract files allow same-origin framing while the ERP pages reject framing", async ({ context }) => {
  const response = await context.request.get(`${server}/api/erp/commercial-contracts/11111111-1111-4111-8111-111111111111/files/22222222-2222-4222-8222-222222222222`, { maxRedirects: 0 })
  expect(response.status()).toBe(401)
  expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'self'")
  expect(response.headers()["x-frame-options"]).toBe("SAMEORIGIN")
})

test("image optimizer accepts the local preview retry query", async ({ context }) => {
  const response = await context.request.get(`${server}/_next/image?url=${encodeURIComponent("/erp-preview.webp?retry=1")}&w=1080&q=75`)
  expect(response.status(), response.ok() ? "" : await response.text()).toBe(200)
  expect(response.headers()["content-type"]).toMatch(/^image\//)
})

test("verified logout follows the discovered Auth endpoint and consumes its flow cookie", async ({ page, context }) => {
  const issuer = "http://127.0.0.1:33130"
  const authorizations: URL[] = []
  const auth = createServer((request, response) => {
    const url = new URL(request.url || "/", issuer)
    if (url.pathname === "/.well-known/openid-configuration") {
      response.writeHead(200, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ issuer, code_challenge_methods_supported: ["S256"], authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, end_session_endpoint: `${issuer}/end-session` }))
      return
    }
    if (url.pathname === "/end-session") {
      authorizations.push(url)
      response.writeHead(200, { "Content-Type": "text/html" })
      response.end("<!doctype html><title>Auth logout fixture</title>")
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise<void>((resolve, reject) => { auth.once("error", reject); auth.listen(33130, "127.0.0.1", resolve) })
  try {
    await page.evaluate(async () => fetch("/api/auth/logout?client_id=foreign&returnTo=https://foreign.test", { method: "POST", redirect: "manual" }).then(response => response.type))
    expect((await context.cookies(origin)).some(cookie => cookie.name === "__Host-erp_logout")).toBe(true)
    await page.goto(`${origin}/api/auth/logout/central`)
    await expect(page).toHaveURL(url => url.origin === issuer && url.pathname === "/end-session")
    expect(authorizations).toHaveLength(1)
    expect(authorizations[0].searchParams.get("client_id")).toBe("cookie-fixture-client")
    expect(authorizations[0].searchParams.get("post_logout_redirect_uri")).toBe(`${origin}/api/auth/logout/central/callback`)
    // Keep redirects manual: the synthetic HTTPS hostname has no public DNS.
    await page.goto(`${origin}/fixture`)
    const flow = (await context.cookies(origin)).find(cookie => cookie.name === "__Host-erp_logout")!
    const callback = await context.request.get(`${server}/api/auth/logout/central/callback`, { maxRedirects: 0, headers: { Cookie: `${flow.name}=${flow.value}` } })
    expect(callback.status()).toBe(303)
    expect(callback.headers().location).toBe(`${origin}/entrar`)
    const callbackType = await page.evaluate(async () => (await fetch("/api/auth/logout/central/callback", { redirect: "manual" })).type)
    expect(callbackType).toBe("opaqueredirect")
    expect((await context.cookies(origin)).filter(cookie => cookie.name.startsWith("__Host-erp_"))).toEqual([])
    const replay = await page.evaluate(async () => (await fetch("/api/auth/logout/central/callback", { redirect: "manual" })).status)
    expect(replay).toBe(403)
  } finally {
    await new Promise<void>(resolve => auth.close(() => resolve()))
  }
})

test("expired logout markers cannot delete a newer session", async ({ page, context }) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-logout"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ phase: "callback", expiresAt: Date.now() - 1000 })), cipher.final()])
  const value = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url")
  await context.addCookies([{ name: "__Host-erp_logout", value, url: origin, secure: true, httpOnly: true, sameSite: "Lax" }])
  const response = await page.evaluate(async () => (await fetch("/api/auth/logout/central/callback", { redirect: "manual" })).status)
  expect(response).toBe(403)
  expect((await context.cookies(origin)).map(cookie => cookie.name)).toEqual(expect.arrayContaining(["__Host-erp_auth", "__Host-erp_session"]))
})

for (const phase of ["start", "callback"] as const) test(`a valid ${phase} logout marker preserves a newer session and login flow`, async ({ page, context }) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-logout"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ phase, expiresAt: Date.now() + 120_000 })), cipher.final()])
  const value = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url")
  await context.addCookies([{ name: "__Host-erp_logout", value, url: origin, secure: true, httpOnly: true, sameSite: "Lax" }])
  const before = (await context.cookies(origin)).filter(cookie => ["__Host-erp_auth", "__Host-erp_session"].includes(cookie.name))
  const result = await page.evaluate(async phase => {
    const response = await fetch(`/api/auth/logout/central${phase === "callback" ? "/callback" : ""}`, { redirect: "manual" })
    return phase === "start" ? response.status : response.type
  }, phase)
  expect(result).toBe(phase === "start" ? 403 : "opaqueredirect")
  expect((await context.cookies(origin)).filter(cookie => ["__Host-erp_auth", "__Host-erp_session"].includes(cookie.name))).toEqual(before)
})
