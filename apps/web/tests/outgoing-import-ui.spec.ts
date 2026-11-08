import { expect, test } from "@playwright/test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { installFrontendFixture, tenant } from "./helpers/frontend-fixture"

// Browser-only fixtures. No fiscal or database service is contacted.
const xml = readFileSync("../api/tests/fixtures/nfe-protocol-synthetic.xml")
const pdf = Buffer.from(readFileSync("../api/tests/fixtures/danfe-provider-synthetic.b64", "utf8"), "base64")
const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex")
const note = { id: 17, accessKey: "35261004252011000110550010000000011000000017", issuerDocument: "04252011000110", issuerName: "Emitente sintético", recipientDocument: "19131243000197", recipientName: "Cliente sintético", number: 1, series: 1, issuedAt: "2026-10-27T15:00:00Z", totalCents: 1000, itemCount: 1, environment: 2, xmlSha256: hash(xml), createdAt: "2026-11-08T15:00:00Z" }
let imported = false
let uncertain = false
let wrongTenant = false
let corrupt = false
let posts: { path: string; body: unknown; tenant?: string }[] = []
let gets: string[] = []

test.beforeEach(async ({ context }) => {
  imported = false; uncertain = false; wrongTenant = false; corrupt = false; posts = []; gets = []
  await installFrontendFixture(context)
  await context.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant, legalName: "Empresa sintética" }, permissions: ["fiscal.nfe.read", "fiscal.nfe.manage"] } }))
  await context.route("**/api/erp/fiscal/outgoing-imports**", async route => {
    const request = route.request(), url = new URL(request.url())
    const tenantId = wrongTenant ? "22222222-2222-4222-8222-222222222222" : tenant
    if (request.method() === "POST") {
      posts.push({ path: url.pathname, body: request.postDataJSON(), tenant: request.headers()["x-tenant-id"] })
      if (uncertain) return route.fulfill({ status: 503, json: { title: "Importação não confirmada" } })
      const replay = imported; imported = true
      return route.fulfill({ status: replay ? 200 : 201, json: note })
    }
    gets.push(url.pathname + url.search)
    if (/\/17\/(xml|danfe)$/.test(url.pathname)) {
      const isPdf = url.pathname.endsWith("danfe")
      return route.fulfill({ contentType: isPdf ? "application/pdf" : "application/xml", body: isPdf ? pdf : xml, headers: { "x-xml-sha256": corrupt ? "0".repeat(64) : note.xmlSha256, "x-pdf-sha256": hash(pdf), "x-nfe-environment": "2" } })
    }
    if (url.pathname.endsWith("/17")) return route.fulfill({ json: { tenantId, data: note } })
    return route.fulfill({ json: { tenantId, canImport: true, data: imported ? [note] : [], total: imported ? 1 : 0 } })
  })
})

test("imports a bounded outbound XML and downloads the exact archived document", async ({ page }) => {
  await page.goto("/fiscal/notas-saida/importar")
  await page.getByLabel("XML da NF-e de saída", { exact: true }).setInputFiles({ name: "saida.xml", mimeType: "application/xml", buffer: xml })
  await page.getByRole("button", { name: "Importar XML", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "XML importado e armazenado" })).toBeVisible()
  expect(posts).toEqual([{ path: "/api/erp/fiscal/outgoing-imports/import", body: { xml: xml.toString("utf8") }, tenant }])
  await page.getByRole("link", { name: "Consultar documento importado" }).click()
  await expect(page.getByRole("heading", { name: "NF-e 1 · Série 1", exact: true })).toBeVisible()
  await expect(page.getByRole("region", { name: "Documento importado", exact: true }).getByText("Cliente sintético · 19131243000197", { exact: true })).toBeVisible()
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "Baixar XML", exact: true }).click()
  const download = await downloadPromise
  expect(await readFile((await download.path())!)).toEqual(xml)
  expect(download.suggestedFilename()).toBe(`NFE-${note.accessKey}.xml`)
})

test("a failed import remains uncertain and never automatically reissues or retries", async ({ page }) => {
  uncertain = true
  await page.goto("/fiscal/notas-saida/importar")
  await page.getByLabel("XML da NF-e de saída", { exact: true }).setInputFiles({ name: "saida.xml", mimeType: "application/xml", buffer: xml })
  await page.getByRole("button", { name: "Importar XML", exact: true }).click()
  await expect(page.locator("main p[role=alert]")).toContainText("Confira a lista antes de reenviar")
  expect(posts).toHaveLength(1)
  await expect(page.getByRole("button", { name: "Importar XML", exact: true })).toBeEnabled()
})

test("rejects oversized uploads locally and refuses a different tenant response", async ({ page }) => {
  await page.goto("/fiscal/notas-saida/importar")
  await page.getByLabel("XML da NF-e de saída", { exact: true }).setInputFiles({ name: "grande.xml", mimeType: "application/xml", buffer: Buffer.alloc(900 * 1024 + 1, 32) })
  await page.getByRole("button", { name: "Importar XML", exact: true }).click()
  await expect(page.locator("main p[role=alert]")).toContainText("até 900 KiB")
  expect(posts).toHaveLength(0)
  wrongTenant = true
  await page.getByRole("button", { name: "Atualizar lista" }).click()
  await expect(page.locator("main p[role=alert]")).toContainText("empresa da sessão mudou")
  await expect(page.getByLabel("XML da NF-e de saída", { exact: true })).toHaveCount(0)
})

test("blocks corrupted documents and sends search and date filters to the archive", async ({ page }) => {
  imported = true
  await page.goto("/fiscal/notas-saida/importar")
  await page.getByLabel("Buscar XML", { exact: true }).fill("Cliente")
  await page.getByLabel("De", { exact: true }).fill("2026-10-01")
  await page.getByLabel("Até", { exact: true }).fill("2026-10-31")
  await page.getByRole("button", { name: "Buscar", exact: true }).click()
  await expect.poll(() => gets.some(path => path.includes("q=Cliente") && path.includes("from=2026-10-01") && path.includes("to=2026-10-31"))).toBe(true)
  await page.getByRole("link", { name: "NF-e 1 / 1", exact: true }).click()
  corrupt = true
  let downloads = 0; page.on("download", () => downloads++)
  await page.getByRole("button", { name: "Baixar DANFE", exact: true }).click()
  await expect(page.locator("main p[role=alert]")).toContainText("não corresponde ao documento armazenado")
  expect(downloads).toBe(0)
})
