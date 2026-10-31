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

test("logout rejects an absent origin without changing either cookie", async ({ context }) => {
  const response = await context.request.post(`${server}/api/auth/logout`, { maxRedirects: 0 })
  expect(response.status()).toBe(403)
  expect((await context.cookies(origin)).filter(cookie => cookie.name.startsWith("__Host-erp_"))).toHaveLength(2)
})
