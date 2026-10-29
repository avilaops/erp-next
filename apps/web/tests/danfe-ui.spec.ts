import { expect, test } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { unzipSync } from "fflate"

const origin = "http://127.0.0.1:33118"
const secret = "danfe-browser-fixture-not-a-real-service-secret"
const tenant = "11111111-1111-4111-8111-111111111111"
const key = "35261004252011000110550010000000011000000017"
const filename = `DANFE-${key}.pdf`
const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex")
let xml: Buffer, pdf: Buffer
let mode: "pdf" | "refused" | "bad-hash" | "bad-pdf" | "batch-refused" = "pdf"
let calls: { authorization: string | undefined; tenant: string | string[] | undefined; xml: string }[] = []
let receivedCalls: string[] = []

function receivedNotes() {
  return [11, 12].map((id, index) => ({ id, accessKey: index ? key.slice(0, -1) + "8" : key, issuerDocument: "04252011000110", issuerName: "EMITENTE SINTÉTICO SEM VALOR FISCAL", recipientDocument: "19131243000197", number: index + 1, series: 1, issuedAt: "2026-10-28T12:00:00Z", totalCents: 1000, itemCount: 1, environment: 2, xmlSha256: sha256(xml), createdAt: "2026-10-28T13:00:00Z" }))
}

// This upstream is a test double. Rust/PostgreSQL checks verify the API separately.
const upstream = createServer(async (request, response) => {
  if (request.method === "GET") {
    receivedCalls.push(request.url!)
    if (request.headers.authorization !== "Bearer danfe-browser-fixture-token" || request.headers["x-tenant-id"] !== tenant) { response.writeHead(403); response.end(); return }
    if (request.url === "/api/v1/me") { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ tenant: { id: tenant, legalName: "Empresa sintética" } })); return }
    const notes = receivedNotes()
    if (request.url?.split("?")[0] === "/api/v1/fiscal/received-nfes") { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ tenantId: tenant, canImport: true, total: notes.length, data: notes })); return }
    const match = request.url?.match(/^\/api\/v1\/fiscal\/received-nfes\/(11|12)(?:\/(xml|danfe))?$/)
    if (match) {
      const note = notes.find(note => note.id === Number(match[1]))!
      if (!match[2]) { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ tenantId: tenant, data: note })); return }
      if (mode === "refused" || mode === "batch-refused" && note.id === 12) { response.writeHead(422, { "Content-Type": "application/problem+json" }); response.end(JSON.stringify({ title: "Assinatura do XML recusada" })); return }
      const isPdf = match[2] === "danfe"
      response.writeHead(200, { "Content-Type": isPdf ? "application/pdf" : "application/xml", "X-XML-SHA256": sha256(xml), "X-PDF-SHA256": mode === "bad-hash" ? "0".repeat(64) : sha256(pdf), "X-NFe-Environment": "2" })
      response.end(isPdf ? pdf : xml); return
    }
  }
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
test.beforeEach(() => { mode = "pdf"; calls = []; receivedCalls = [] })

test("stored note detail previews and downloads the verified PDF through the authenticated BFF", async ({ page, context }) => {
  await context.addCookies([cookie()])
  await page.goto("/fiscal/monitor/11")
  await expect(page.getByRole("heading", { name: "NF-e 1 · Série 1", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Visualizar DANFE", exact: true }).click()
  await expect(page.getByTitle("Visualização do DANFE", { exact: true })).toHaveAttribute("src", /^blob:/)
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("link", { name: "Baixar DANFE em PDF", exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(filename)
  expect(await readFile((await download.path())!)).toEqual(pdf)
  expect(receivedCalls).toContain("/api/v1/fiscal/received-nfes/11/danfe")
  expect((await context.request.get("/api/erp/fiscal/received-nfes/11/danfe", { headers: { "X-Tenant-Id": "22222222-2222-4222-8222-222222222222" } })).status()).toBe(409)
})

test("batch download contains both verified PDFs and retains selection when one fails", async ({ page, context }) => {
  await context.addCookies([cookie()])
  await page.goto("/fiscal/monitor")
  await page.getByLabel("Selecionar NF-e 1 para o lote", { exact: true }).check()
  await page.getByLabel("Selecionar NF-e 2 para o lote", { exact: true }).check()
  mode = "batch-refused"
  let downloads = 0
  page.on("download", () => downloads++)
  await page.getByRole("button", { name: "Baixar DANFEs selecionados (ZIP)", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "O lote não foi baixado" })).toContainText("NF-e 2. Assinatura do XML recusada")
  expect(downloads).toBe(0)
  await expect(page.getByLabel("Selecionar NF-e 1 para o lote", { exact: true })).toBeChecked()
  await expect(page.getByLabel("Selecionar NF-e 2 para o lote", { exact: true })).toBeChecked()
  mode = "pdf"
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "Baixar DANFEs selecionados (ZIP)", exact: true }).click()
  const download = await downloadPromise
  const files = unzipSync(await readFile((await download.path())!))
  expect(Object.keys(files).sort()).toEqual(receivedNotes().map(note => `DANFE-${note.accessKey}.pdf`).sort())
  for (const value of Object.values(files)) expect(Buffer.from(value)).toEqual(pdf)
  await expect(page.getByRole("status").filter({ hasText: "Lote completo" })).toContainText("2 DANFE(s)")
})

test("a corrupted PDF hash is never exposed in the stored note preview", async ({ page, context }) => {
  await context.addCookies([cookie()])
  mode = "bad-hash"
  await page.goto("/fiscal/monitor/11")
  await page.getByRole("button", { name: "Visualizar DANFE", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "O download" })).toContainText("não corresponde ao documento armazenado")
  await expect(page.getByTitle("Visualização do DANFE", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Baixar DANFE em PDF", exact: true })).toHaveCount(0)
})

test("BFF refuses anonymous, expired, foreign-origin and changed-company requests before the upstream", async ({ page, context }) => {
  await page.goto("/fiscal/danfe")
  await expect(page).toHaveURL(/\/entrar$/)
  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible()
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
