import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant } from "./helpers/frontend-fixture"

test.beforeEach(async ({ context }) => installFrontendFixture(context))

test("gerenciador de arquivos filtra, baixa legados e arquiva registros atuais", async ({ page }) => {
  let archived = false
  const files = [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", origin: "system", filename: "manual.pdf", mediaType: "application/pdf", byteSize: 2048, sha256: "a".repeat(64), status: "available", revision: 1, versionCount: 0, createdAt: "2026-11-05T12:00:00Z" },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", origin: "legacy", filename: "nota.xml", mediaType: "application/xml", byteSize: 4, sha256: "b".repeat(64), status: "available", revision: 1, versionCount: 1, createdAt: "2026-10-01T12:00:00Z" },
  ]
  await page.route("**/api/erp/system/files**", async route => {
    const request = route.request()
    if (request.method() === "POST") {
      expect(request.headers()["if-match"]).toBe('"1"')
      archived = true
      return route.fulfill({ json: { tenantId: tenant, data: { ...files[0], status: "archived", revision: 2 } } })
    }
    const origin = new URL(request.url()).searchParams.get("origin")
    const current = files
      .map((file, index) => index === 0 && archived ? { ...file, status: "archived", revision: 2 } : file)
      .filter(file => !origin || file.origin === origin)
    return route.fulfill({ json: { tenantId: tenant, data: current, total: current.length, offset: 0, limit: 25, canEdit: true } })
  })

  await page.goto("/preferencias/sistema/arquivos")
  await expect(page.getByRole("heading", { name: "Arquivos da empresa", exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Baixar" })).toHaveAttribute("download", "nota.xml")
  await page.getByRole("button", { name: "Arquivar" }).click()
  await expect.poll(() => archived).toBe(true)
  await expect(page.getByRole("status")).toContainText("manual.pdf foi arquivado")
  await page.getByLabel("Origem").selectOption("legacy")
  await expect(page.getByText("nota.xml", { exact: true })).toBeVisible()
  await expect(page.getByText("manual.pdf", { exact: true })).toHaveCount(0)
})
