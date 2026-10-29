import { expect, test, type BrowserContext } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"

const origin = process.env.ERP_TEST_WEB_ORIGIN || "http://127.0.0.1:3202"
const tenant = "11111111-1111-4111-8111-111111111111"
const headers = { Origin: origin, "X-Tenant-Id": tenant }
let fixture: Record<string, string>
test.beforeAll(async () => { fixture = JSON.parse(await readFile("../api/tests/fixtures/a1-synthetic.json", "utf8")) })

// Synthetic identity and synthetic CA, restricted to the isolated local database.
async function session(context: BrowserContext, reader = false) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(process.env.ERP_SESSION_SECRET!).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: reader ? "fixture-reader-token" : "fixture-editor-token", tenantId: tenant, expiresAt: Date.now() + 3600_000 })), cipher.final()])
  await context.addCookies([{ name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" }])
}

test("certificado A1 conecta, persiste, substitui com revisão e remove pela interface", async ({ page, context }, info) => {
  await session(context)
  await page.goto("/preferencias/certificado-digital")
  const upload = page.getByLabel("Arquivo do certificado A1", { exact: true })
  const password = page.getByLabel("Senha do certificado", { exact: true })
  await expect(upload).toBeEnabled()
  const choose = async (kind: string) => {
    await upload.setInputFiles({ name: "a1-sintetico.pfx", mimeType: "application/x-pkcs12", buffer: Buffer.from(fixture[kind], "base64") })
    await password.fill(fixture.password)
  }
  await choose("valid")
  await page.getByRole("button", { name: "Conectar certificado", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "armazenado com criptografia" })).toBeVisible()
  await expect(password).toHaveValue("")
  const first = await (await context.request.get("/api/erp/fiscal/certificate")).json()
  expect(first.status).toBe("active")
  await page.reload()
  await expect(page.getByRole("heading", { name: "Certificado conectado", exact: true })).toBeVisible()
  await page.getByText("Dados da verificação", { exact: true }).click()
  await expect(page.getByText(first.data.fingerprint, { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath("certificado-desktop.png"), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.screenshot({ path: info.outputPath("certificado-mobile.png"), fullPage: true })
  await choose("legacy")
  await page.getByRole("button", { name: "Validar e substituir certificado", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "armazenado com criptografia" })).toBeVisible()
  const stored = await context.request.get("/api/erp/fiscal/certificate")
  const second = await stored.json()
  expect(second.data.fingerprint).not.toBe(first.data.fingerprint)
  const concurrent = await context.request.put("/api/erp/fiscal/certificate", { headers: { ...headers, "If-Match": stored.headers().etag }, data: { pkcs12Base64: fixture.valid, password: fixture.password } })
  expect(concurrent.status()).toBe(200)
  await choose("legacy")
  await page.getByRole("button", { name: "Validar e substituir certificado", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Outra pessoa alterou" })).toBeVisible()
  await expect(password).toHaveValue("")
  expect(await upload.evaluate((input: HTMLInputElement) => input.files?.length)).toBe(1)
  await page.getByRole("button", { name: "Recarregar dados do servidor", exact: true }).click()
  await expect(upload).toBeEnabled()
  await password.fill(fixture.password)
  await page.getByRole("button", { name: "Validar e substituir certificado", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "armazenado com criptografia" })).toBeVisible()
  page.once("dialog", dialog => dialog.accept())
  await page.getByRole("button", { name: "Remover certificado", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "removido desta empresa" })).toBeVisible()
  const removed = await (await context.request.get("/api/erp/fiscal/certificate")).json()
  expect(removed.data).toBeNull()
  expect(removed.status).toBe("not_configured")
  await choose("valid")
  await page.getByRole("button", { name: "Conectar certificado", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "armazenado com criptografia" })).toBeVisible()
})

test("senha incorreta, outro CNPJ e vencimento preservam o certificado conectado", async ({ page, context }) => {
  await session(context)
  await page.goto("/preferencias/certificado-digital")
  const before = await (await context.request.get("/api/erp/fiscal/certificate")).json()
  for (const [kind, password, message] of [["valid", "senha-incorreta-qa", "Senha incorreta"], ["otherCompany", fixture.password, "CNPJ"], ["expired", fixture.password, "vencido"]]) {
    await page.getByLabel("Arquivo do certificado A1", { exact: true }).setInputFiles({ name: "certificado.p12", mimeType: "application/x-pkcs12", buffer: Buffer.from(fixture[kind], "base64") })
    await page.getByLabel("Senha do certificado", { exact: true }).fill(password)
    await page.getByRole("button", { name: "Validar e substituir certificado", exact: true }).click()
    await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible()
    await expect(page.getByLabel("Senha do certificado", { exact: true })).toHaveValue("")
  }
  const after = await (await context.request.get("/api/erp/fiscal/certificate")).json()
  expect(after.revision).toBe(before.revision)
  expect(after.data.fingerprint).toBe(before.data.fingerprint)
  const changedCompany = await context.request.put("/api/erp/fiscal/certificate", { headers: { ...headers, "X-Tenant-Id": "22222222-2222-4222-8222-222222222222", "If-Match": `"${after.revision}"` }, data: { pkcs12Base64: fixture.valid, password: fixture.password } })
  expect(changedCompany.status()).toBe(409)
})

test("piloto sem permissão fiscal não recebe dados nem formulário de certificado", async ({ page, context }) => {
  await session(context, true)
  await page.goto("/preferencias/certificado-digital")
  await expect(page.getByRole("alert").filter({ hasText: "Acesso não autorizado" })).toBeVisible()
  await expect(page.getByLabel("Arquivo do certificado A1", { exact: true })).toHaveCount(0)
  expect((await context.request.get("/api/erp/fiscal/certificate")).status()).toBe(403)
})
