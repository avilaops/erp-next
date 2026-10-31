import { expect, test } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { origin, secret, server } from "../playwright.session.config"

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
  expect((await context.cookies(origin)).filter(cookie => cookie.name.startsWith("__Host-erp_"))).toEqual([])
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
  await expect(page.getByRole("alert")).toContainText("outro navegador")
  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible()
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
    await expect(page.getByRole("alert")).toBeVisible()
    await expect(page.locator('form[action="/api/auth/login"] input[name="returnTo"]')).toHaveValue("/cadastros/produtos?pagina=2")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole("button", { name: "Entrar", exact: true }).focus()
    await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeFocused()
    await page.screenshot({ path: testInfo.outputPath(`reiniciar-acesso-${width}.png`), fullPage: true, caret: "initial" })
  }
})

test("logout rejects an absent origin without changing either cookie", async ({ context }) => {
  const response = await context.request.post(`${server}/api/auth/logout`, { maxRedirects: 0 })
  expect(response.status()).toBe(403)
  expect((await context.cookies(origin)).filter(cookie => cookie.name.startsWith("__Host-erp_"))).toHaveLength(2)
})
