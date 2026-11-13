import { test, expect } from "@playwright/test"
import { createServer } from "node:http"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

test.beforeEach(async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  await page.addInitScript(() => { const target = window as unknown as Window & { printCalls: number }; target.printCalls = 0; window.print = () => { target.printCalls++ } })
  await page.route(`**/api/erp/orders/${record}`, route => route.fulfill({ headers: { ETag: '"3"' }, json: { tenantId: tenant, canEdit: true, pricingOrigin: false, data: { id: record, number: "4", customerId: record, customerName: "Cliente de teste", customerTaxId: "52998224725", dueDate: "2026-12-12", amount: "5643.80", status: "draft", revision: 3 }, items: [] } }))
})

test("Salvar PDF baixa documento canônico com revisão sem imprimir a tela", async ({ page }) => {
  let reads = 0
  await page.route(`**/api/erp/orders/${record}/document`, route => {
    reads++
    expect(route.request().method()).toBe("GET")
    expect(route.request().headers()["if-match"]).toBe('"3"')
    return route.fulfill({ contentType: "application/pdf", headers: { "Content-Disposition": 'attachment; filename="pedido-PV-000004-r3.pdf"', ETag: '"3"' }, body: Buffer.from("%PDF-1.7\n%synthetic-pdf\n") })
  })
  await page.goto(`/vendas/pedidos/${record}`)
  const download = page.waitForEvent("download", { timeout: 5000 })
  await page.getByRole("button", { name: "Salvar PDF", exact: true }).click()
  expect(await page.evaluate(() => (window as unknown as Window & { printCalls: number }).printCalls)).toBe(0)
  expect((await download).suggestedFilename()).toBe("pedido-PV-000004-r3.pdf")
  expect(reads).toBe(1)
})

test("pedido alterado explica falha de PDF sem exportar versão antiga", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route(`**/api/erp/orders/${record}/document`, route => route.fulfill({ status: 412, json: { title: "O pedido foi alterado. Atualize os dados antes de gerar o PDF." } }))
  let downloads = 0
  page.on("download", () => downloads++)
  await page.goto(`/vendas/pedidos/${record}`)
  await page.getByRole("button", { name: "Salvar PDF", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "pedido foi alterado" })).toBeVisible()
  expect(downloads).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("BFF preserva bytes binários, empresa, revisão e nome do PDF", async ({ context }) => {
  const expected = Buffer.from([37, 80, 68, 70, 45, 49, 46, 55, 10, 0, 255, 128, 10])
  let reads = 0
  const server = createServer((request, response) => {
    reads++
    expect(request.url).toBe(`/api/v1/orders/${record}/document`)
    expect(request.headers["x-tenant-id"]).toBe(tenant)
    expect(request.headers["if-match"]).toBe('"3"')
    expect(request.headers.accept).toBe("application/pdf")
    response.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="pedido-PV-000004-r3.pdf"', ETag: '"3"' })
    response.end(expected)
  })
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(33191, "127.0.0.1", resolve) })
  try {
    const path = `/api/erp/orders/${record}/document`
    const response = await context.request.get(path, { headers: { "If-Match": '"3"' } })
    expect(response.status()).toBe(200)
    expect(await response.body()).toEqual(expected)
    expect(response.headers()["etag"]).toBe('"3"')
    expect(response.headers()["content-disposition"]).toContain("pedido-PV-000004-r3.pdf")
    expect((await context.request.get(`${path}?unexpected=1`)).status()).toBe(400)
    await context.clearCookies()
    expect((await context.request.get(path)).status()).toBe(401)
    expect(reads).toBe(1)
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})
