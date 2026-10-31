import type { BrowserContext } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { origin, secret } from "../../playwright.danfe.config"

export const tenant = "11111111-1111-4111-8111-111111111111"
export const record = "22222222-2222-4222-8222-222222222222"

export async function installFrontendFixture(context: BrowserContext) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const data = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "frontend-integration-fixture", tenantId: tenant, expiresAt: Date.now() + 3600_000 })), cipher.final()])
  await context.addCookies([{ name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" }])
  await context.route("**/api/erp/**", route => route.fulfill({ status: route.request().method() === "GET" ? 503 : 405, json: { title: "Operação indisponível na fixture de leitura" } }))
}
