import { expect, test } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"

const origin = process.env.ERP_TEST_WEB_ORIGIN || "http://127.0.0.1:3202"
const tenant = "11111111-1111-4111-8111-111111111111"

function cookie(token: string, expiresAt = Date.now() + 3600_000) {
  const iv = randomBytes(12)
  const key = createHash("sha256").update(process.env.ERP_SESSION_SECRET!).digest()
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: token, tenantId: tenant, expiresAt })), cipher.final()])
  return { name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" as const }
}

test("login com PKCE grava a empresa e mantém a gravação após recarregar", async ({ page, context }) => {
  await page.goto("/entrar")
  await page.getByRole("button", { name: "Entrar", exact: true }).click()
  await expect(page).toHaveURL(/\/preferencias\/empresa\/dados$/)
  const name = `Empresa persistida ${Date.now()}`
  await page.getByLabel("Nome fantasia", { exact: true }).fill(name)
  await page.getByRole("button", { name: "Salvar alterações" }).click()
  await expect(page.getByText("Cadastro salvo no servidor.")).toBeVisible()
  await page.reload()
  await expect(page.getByLabel("Nome fantasia", { exact: true })).toHaveValue(name)
  const cookies = await context.cookies()
  expect(cookies.find((item) => item.name === "erp_session")?.httpOnly).toBe(true)
  expect(await page.evaluate(() => document.cookie)).not.toContain("erp_session")
  expect(await page.content()).not.toContain("fixture-editor-token")
  await page.screenshot({ path: "../../evidencias/screenshots/erp-company-desktop.png", fullPage: true })
  await page.goto("/preferencias/empresa")
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
  await expect(page.getByText("78%", { exact: true })).toHaveCount(0)
})

test("conflito preserva a edição e exige recarregar explicitamente", async ({ page, context }) => {
  await context.addCookies([cookie("fixture-editor-token")])
  await page.goto("/preferencias/empresa/dados")
  const name = page.getByLabel("Nome fantasia", { exact: true })
  await expect(name).toBeVisible()
  const snapshot = await context.request.get("/api/erp/company")
  const data = await snapshot.json()
  const remote = await context.request.put("/api/erp/company", { headers: { Origin: origin, "If-Match": snapshot.headers().etag, "X-Tenant-Id": tenant }, data: { ...data.data, tradeName: "Edição de outra pessoa" } })
  expect(remote.status()).toBe(200)
  await name.fill("Minha edição preservada")
  await page.getByRole("button", { name: "Salvar alterações" }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Outra pessoa alterou" })).toBeVisible()
  await expect(name).toHaveValue("Minha edição preservada")
  await expect(page.getByRole("button", { name: "Salvar alterações" })).toBeDisabled()
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: "Recarregar e descartar edição" }).click()
  await expect(name).toHaveValue("Edição de outra pessoa")
})

test("BFF bloqueia anônimo, origem externa, troca de empresa e credencial expirada", async ({ context }) => {
  expect((await context.request.get("/api/erp/company")).status()).toBe(401)
  await context.addCookies([cookie("fixture-editor-token")])
  const snapshot = await context.request.get("/api/erp/company")
  const data = await snapshot.json()
  expect((await context.request.put("/api/erp/company", { headers: { Origin: "https://untrusted.example", "X-Tenant-Id": tenant, "If-Match": snapshot.headers().etag }, data: data.data })).status()).toBe(403)
  expect((await context.request.put("/api/erp/company", { headers: { Origin: origin, "X-Tenant-Id": "22222222-2222-4222-8222-222222222222", "If-Match": snapshot.headers().etag }, data: data.data })).status()).toBe(409)
  await context.addCookies([cookie("fixture-editor-token", Date.now() - 1000)])
  expect((await context.request.get("/api/erp/company")).status()).toBe(401)
  await context.addCookies([{ ...cookie("fixture-editor-token"), value: "tampered" }])
  expect((await context.request.get("/api/erp/company")).status()).toBe(401)
  expect((await context.request.get("/api/auth/callback?code=invalid&state=invalid")).status()).toBe(400)
})

test("consulta sem edição e formulário móvel usam dados reais sem overflow", async ({ page, context }) => {
  await context.addCookies([cookie("fixture-reader-token")])
  await page.setViewportSize({ width: 375, height: 844 })
  await page.goto("/preferencias/empresa/dados")
  await expect(page.getByText("Você tem acesso de consulta.", { exact: false })).toBeVisible()
  await expect(page.getByLabel("Nome fantasia", { exact: true })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.screenshot({ path: "../../evidencias/screenshots/erp-company-mobile.png", fullPage: true })
})
