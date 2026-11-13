import { expect, test } from "@playwright/test"
import { createServer } from "node:http"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

test.beforeEach(async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  await page.route(`**/api/erp/orders/${record}`, route => route.fulfill({ headers: { ETag: '"3"' }, json: { tenantId: tenant, canEdit: true, pricingOrigin: false, data: { id: record, number: "17", customerId: record, customerName: "Cliente do pedido", customerTaxId: "52998224725", dueDate: "2026-12-30", amount: "199.00", status: "draft", revision: 3 }, items: [] } }))
})

test("botão abre destinatário real e envia somente a mensagem explícita com revisão", async ({ page }) => {
  let sends = 0
  await page.route(`**/api/erp/orders/${record}/email`, async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { tenantId: tenant, recipient: "cliente@example.test", canSend: true, emailReady: true, deliveries: [] } })
    sends++
    expect(route.request().headers()["if-match"]).toBe('"3"')
    expect(route.request().headers()["idempotency-key"]).toMatch(/^[a-f0-9-]{36}$/)
    expect(route.request().postDataJSON()).toEqual({ recipient: "cliente@example.test", subject: "Pedido PV-000017", message: "Confira seu pedido em anexo." })
    return route.fulfill({ headers: { ETag: '"3"' }, json: { tenantId: tenant, revision: 3, delivery: { id: record, recipient: "cliente@example.test", status: "sent", createdAt: "2026-11-09T12:00:00Z" } } })
  })
  await page.goto(`/vendas/pedidos/${record}`)
  await page.getByRole("button", { name: "Enviar por e-mail", exact: true }).click()
  const composer = page.getByRole("dialog")
  await expect(composer.getByLabel("Destinatário", { exact: true })).toHaveValue("cliente@example.test")
  await expect(composer.getByText(/Anexo: documento do pedido/)).toBeVisible()
  expect(sends).toBe(0)
  await composer.getByLabel("Mensagem", { exact: true }).fill("Confira seu pedido em anexo.")
  await composer.getByRole("button", { name: "Enviar e-mail com anexo", exact: true }).click()
  await expect(composer.getByRole("status")).toContainText("Aceito pelo servidor de e-mail")
  await expect(composer.getByRole("button", { name: "Enviar e-mail com anexo", exact: true })).toBeDisabled()
  expect(sends).toBe(1)
})

for (const mode of ["unconfigured", "readonly", "uncertain"] as const) test(`envio ${mode} informa motivo e impede nova mensagem`, async ({ page }) => {
  let sends = 0
  await page.route(`**/api/erp/orders/${record}/email`, route => {
    if (route.request().method() !== "GET") sends++
    return route.fulfill({ json: { tenantId: tenant, recipient: "cliente@example.test", canSend: mode !== "readonly", emailReady: mode !== "unconfigured", deliveries: mode === "uncertain" ? [{ id: record, recipient: "cliente@example.test", status: "uncertain", createdAt: "2026-11-09T12:00:00Z" }] : [] } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/vendas/pedidos/${record}`)
  await page.getByRole("button", { name: "Enviar por e-mail", exact: true }).click()
  const composer = page.getByRole("dialog")
  await expect(composer.getByText(mode === "unconfigured" ? /ainda não está configurado/ : mode === "readonly" ? /Envio indisponível/ : /Há um envio sem confirmação/)).toBeVisible()
  await expect(composer.getByRole("button", { name: "Enviar e-mail com anexo", exact: true })).toBeDisabled()
  expect(sends).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("BFF preserva empresa, revisão e comando e recusa origem, empresa ou consulta indevidas", async ({ context, baseURL }) => {
  const requests: { url: string | undefined; authorization: string | undefined; tenant: string | string[] | undefined; revision: string | string[] | undefined; key: string | string[] | undefined; body: string }[] = []
  const server = createServer(async (request, response) => {
    let body = ""
    for await (const chunk of request) body += chunk.toString()
    requests.push({ url: request.url, authorization: request.headers.authorization, tenant: request.headers["x-tenant-id"], revision: request.headers["if-match"], key: request.headers["idempotency-key"], body })
    response.writeHead(200, { "Content-Type": "application/json", ETag: '"3"' })
    response.end(JSON.stringify({ tenantId: tenant }))
  })
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(Number(process.env.ERP_TEST_API_PORT || 33119), "127.0.0.1", resolve) })
  const key = "33333333-3333-4333-8333-333333333333"
  const path = `/api/erp/orders/${record}/email`
  const body = { recipient: "cliente@example.test", subject: "Pedido", message: "Documento em anexo." }
  const headers = { Origin: baseURL!, "X-Tenant-Id": tenant, "If-Match": '"3"', "Idempotency-Key": key }
  try {
    expect((await context.request.get(path)).status()).toBe(200)
    const posted = await context.request.post(path, { headers, data: body })
    expect(posted.status()).toBe(200)
    expect(posted.headers().etag).toBe('"3"')
    expect(requests[1]).toEqual({ url: `/api/v1/orders/${record}/email`, authorization: "Bearer frontend-integration-fixture", tenant, revision: '"3"', key, body: JSON.stringify(body) })
    expect((await context.request.get(`${path}?unexpected=1`)).status()).toBe(400)
    expect((await context.request.post(path, { headers: { ...headers, Origin: "https://other.example.test" }, data: body })).status()).toBe(403)
    expect((await context.request.post(path, { headers: { ...headers, "X-Tenant-Id": record }, data: body })).status()).toBe(409)
    expect(requests).toHaveLength(2)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
