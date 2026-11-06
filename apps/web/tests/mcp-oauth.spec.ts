import { expect, test } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { createServer, type Server } from "node:http"
import { origin, secret, server } from "../playwright.session.config"

const authorization = new URLSearchParams({ client_id: "fixture", redirect_uri: "https://client.example/callback", response_type: "code", code_challenge: "a".repeat(43), code_challenge_method: "S256", resource: `${origin}/mcp`, scope: "erp.read erp.write", state: "client-state" })
let api: Server
let grants: string[]

test.beforeEach(async ({ page, context }) => {
  grants = []
  api = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1:33129")
    response.setHeader("Content-Type", "application/json")
    if (url.pathname === "/mcp/oauth/authorization-request") {
      response.end(JSON.stringify({ client_name: '<script>window.injected = true</script>', redirect_uri: "https://client.example/callback", scope: "erp.read erp.write" }))
    } else if (url.pathname === "/mcp/oauth/grant") {
      grants.push(request.headers.authorization || "")
      for await (const _chunk of request) { /* Consume the real request stream. */ }
      response.statusCode = 201
      response.end(JSON.stringify({ redirect_uri: "https://client.example/callback?state=client-state&code=fixture-code" }))
    } else if (url.pathname === "/mcp") {
      response.statusCode = 401
      response.setHeader("WWW-Authenticate", `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`)
      response.end(JSON.stringify({ error: "invalid_token" }))
    } else {
      response.statusCode = 404
      response.end("{}")
    }
  })
  await new Promise<void>((resolve, reject) => { api.once("error", reject); api.listen(33129, "127.0.0.1", resolve) })
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "private-auth-fixture", tenantId: null, expiresAt: Date.now() + 3600_000 })), cipher.final()])
  await context.addCookies([{ name: "__Host-erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, secure: true, httpOnly: true, sameSite: "Lax" }])
  await page.route(`${origin}/**`, async route => {
    const requested = new URL(route.request().url())
    const response = await route.fetch({ url: `${server}${requested.pathname}${requested.search}`, maxRedirects: 0 })
    await route.fulfill({ response })
  })
  await page.route("https://client.example/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>MCP client callback</title>" }))
})

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" })
  await new Promise<void>(resolve => { api.closeAllConnections(); api.close(() => resolve()) })
})

test("MCP does not redirect token clients to the ERP browser login", async ({ context }) => {
  const response = await context.request.post(`${server}/mcp`, { data: { jsonrpc: "2.0", id: 1, method: "initialize" }, maxRedirects: 0 })
  expect(response.status()).toBe(401)
  expect(response.headers()["www-authenticate"]).toContain("oauth-protected-resource/mcp")
})

test("OAuth displays consent with escaped client metadata and requires a deliberate approval", async ({ page }) => {
  await page.goto(`${origin}/mcp/oauth/authorize?${authorization}`)
  await expect(page.getByRole("heading", { name: "Autorizar conexão com o ERP" })).toBeVisible()
  await expect(page.locator("body")).toContainText("<script>window.injected = true</script>")
  expect(await page.evaluate(() => "injected" in window)).toBe(false)
  expect(await page.content()).not.toContain("private-auth-fixture")
  expect(grants).toHaveLength(0)
  await page.getByRole("button", { name: "Autorizar", exact: true }).click()
  await expect(page).toHaveURL("https://client.example/callback?state=client-state&code=fixture-code")
  expect(grants).toEqual(["Bearer private-auth-fixture"])
})

test("denying consent preserves state without creating a grant", async ({ page }) => {
  await page.goto(`${origin}/mcp/oauth/authorize?${authorization}`)
  await page.getByRole("button", { name: "Recusar", exact: true }).click()
  await expect(page).toHaveURL(url => url.origin === "https://client.example" && url.searchParams.get("error") === "access_denied" && url.searchParams.get("state") === "client-state")
  expect(grants).toHaveLength(0)
})

test("consent rejects a missing CSRF value and cross-origin POST", async ({ page, context }) => {
  await page.goto(`${origin}/mcp/oauth/authorize?${authorization}`)
  const status = await page.evaluate(async () => (await fetch("/mcp/oauth/authorize", { method: "POST", body: new URLSearchParams({ decision: "allow", csrf: "wrong" }) })).status)
  expect(status).toBe(403)
  const response = await context.request.post(`${server}/mcp/oauth/authorize`, { headers: { Origin: "https://attacker.example" }, form: { decision: "allow" }, maxRedirects: 0 })
  expect(response.status()).toBe(403)
  expect(grants).toHaveLength(0)
})
