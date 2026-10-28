import { expect, test } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"

const origin = "http://127.0.0.1:33118"
const secret = "danfe-browser-fixture-not-a-real-service-secret"
const tenant = "11111111-1111-4111-8111-111111111111"
const key = "35261004252011000110550010000000011000000017"
const filename = `DANFE-${key}.pdf`
const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex")
let xml: Buffer, pdf: Buffer
let mode: "pdf" | "refused" | "bad-hash" | "bad-pdf" = "pdf"
let calls: { authorization: string | undefined; tenant: string | string[] | undefined; xml: string }[] = []

// This upstream is a test double. Rust/PostgreSQL checks verify the API separately.
const upstream = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/api/v1/fiscal/danfe") { response.writeHead(404); response.end(); return }
  let body = ""
  for await (const chunk of request) body += chunk
  const input = JSON.parse(body) as { xml: string }
  calls.push({ authorization: request.headers.authorization, tenant: request.headers["x-tenant-id"], xml: input.xml })
  if (mode === "refused") {
    response.writeHead(422, { "Content-Type": "application/problem+json" })
    response.end(JSON.stringify({ title: "Assinatura do XML recusada", status: 422 })); return
  }
  response.writeHead(200, {
    "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`,
    "X-XML-SHA256": sha256(Buffer.from(input.xml)), "X-PDF-SHA256": mode === "bad-hash" ? "0".repeat(64) : sha256(pdf),
    "X-NFe-Environment": "2", "X-NFe-Authorization-Check": "xml-protocol-only",
  })
  response.end(mode === "bad-pdf" ? Buffer.from("not a PDF") : pdf)
})

function cookie(expiresAt = Date.now() + 3600_000) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "danfe-browser-fixture-token", tenantId: tenant, expiresAt })), cipher.final()])
  return { name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" as const }
}

test.beforeAll(async () => {
  xml = await readFile("../api/tests/fixtures/nfe-protocol-synthetic.xml")
  pdf = Buffer.from(await readFile("../api/tests/fixtures/danfe-provider-synthetic.b64", "utf8"), "base64")
  await new Promise<void>((resolve, reject) => { upstream.once("error", reject); upstream.listen(33119, "127.0.0.1", resolve) })
})
test.afterAll(async () => { if (upstream.listening) await new Promise<void>(resolve => upstream.close(() => resolve())) })
test.beforeEach(() => { mode = "pdf"; calls = [] })

test("BFF refuses anonymous, expired, foreign-origin and changed-company requests before the upstream", async ({ page, context }) => {
  await page.goto("/fiscal/danfe")
  await expect(page.getByRole("status").filter({ hasText: "Entre para gerar" })).toBeVisible()
  const post = (headers = {}) => context.request.post("/api/erp/fiscal/danfe", { headers: { Origin: origin, "X-Tenant-Id": tenant, ...headers }, data: { xml: xml.toString() } })
  expect((await post()).status()).toBe(401)
  await context.addCookies([cookie(Date.now() - 1000)])
  expect((await post()).status()).toBe(401)
  await context.addCookies([cookie()])
  expect((await post({ Origin: "https://foreign.example" })).status()).toBe(403)
  expect((await post({ "X-Tenant-Id": "22222222-2222-4222-8222-222222222222" })).status()).toBe(409)
  expect(calls).toHaveLength(0)
})

test("browser downloads the exact PDF through the BFF and checks XML and PDF hashes", async ({ page, context }, testInfo) => {
  await context.addCookies([cookie()])
  const pageErrors: string[] = []
  page.on("pageerror", error => pageErrors.push(error.message))
  await page.goto("/fiscal/danfe")
  // UTF-8 BOM must survive decoding/JSON/proxy and still match the original file hash.
  const upload = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), xml])
  await expect(page.getByLabel("XML autorizado da NF-e")).toBeEnabled()
  await page.getByLabel("XML autorizado da NF-e").setInputFiles({ name: "fixture.xml", mimeType: "application/xml", buffer: upload })
  await page.getByRole("button", { name: "Gerar DANFE", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "DANFE gerado" })).toContainText("Homologação")
  await expect(page.getByText(sha256(upload), { exact: true })).toBeVisible()
  await expect(page.getByText(sha256(pdf), { exact: true })).toBeVisible()
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("link", { name: "Baixar DANFE em PDF" }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(filename)
  expect(await readFile((await download.path())!)).toEqual(pdf)
  expect(calls).toEqual([{ authorization: "Bearer danfe-browser-fixture-token", tenant, xml: upload.toString() }])
  expect(await page.content()).not.toContain("danfe-browser-fixture-token")
  expect(pageErrors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath("danfe-desktop.png"), fullPage: true })
})

test("rejected signatures, invalid transport and mismatched hashes preserve the file and never expose a download", async ({ page, context }) => {
  await context.addCookies([cookie()])
  await page.goto("/fiscal/danfe")
  await expect(page.getByLabel("XML autorizado da NF-e")).toBeEnabled()
  await page.getByLabel("XML autorizado da NF-e").setInputFiles({ name: "fixture.xml", mimeType: "application/xml", buffer: xml })
  for (const [responseMode, message] of [["refused", "Assinatura do XML recusada"], ["bad-pdf", "O serviço não devolveu um PDF válido"], ["bad-hash", "O documento recebido não corresponde aos hashes da geração"]] as const) {
    mode = responseMode
    await page.getByRole("button", { name: "Gerar DANFE", exact: true }).click()
    await expect(page.getByRole("alert").filter({ hasText: message })).toHaveText(message)
    await expect(page.getByRole("link", { name: "Baixar DANFE em PDF" })).toHaveCount(0)
    expect(await page.getByLabel("XML autorizado da NF-e").evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe("fixture.xml")
  }
  expect(calls).toHaveLength(3)
})

test("mobile form fits the viewport and rejects oversized XML before the BFF", async ({ page, context }, testInfo) => {
  await context.addCookies([cookie()])
  await page.setViewportSize({ width: 375, height: 844 })
  await page.goto("/fiscal/danfe")
  await expect(page.getByLabel("XML autorizado da NF-e")).toBeEnabled()
  await page.getByLabel("XML autorizado da NF-e").setInputFiles({ name: "large.xml", mimeType: "application/xml", buffer: Buffer.alloc(900 * 1024 + 1, 120) })
  await page.getByRole("button", { name: "Gerar DANFE", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Selecione um XML de até 900 KiB" })).toHaveText("Selecione um XML de até 900 KiB")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(calls).toHaveLength(0)
  await page.screenshot({ path: testInfo.outputPath("danfe-mobile.png"), fullPage: true })
})
