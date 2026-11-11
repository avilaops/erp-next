import { expect, test } from "@playwright/test"
import { createServer } from "node:http"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

const proposal = { id: record, number: "2", version: 1, revision: 3, customerId: record, customerName: "Cliente da proposta", validUntil: "2100-01-01", amount: "19419.84", status: "draft", expired: false, isCurrent: true, orderId: null, paymentTerms: "30 dias", deliveryTerms: "30 dias", notes: "" }
test.beforeEach(async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  await page.route(`**/api/erp/proposals/${record}*`, route => route.fulfill({ headers: { ETag: '"3"' }, json: { tenantId: tenant, canEdit: true, data: proposal, items: [], versions: [proposal] } }))
})

for (const width of [390, 1280]) test(`proposta abre envio explícito e atualiza revisão após confirmação em ${width}px`, async ({ page }) => {
  let sends = 0
  let sent = false
  await page.route(`**/api/erp/proposals/${record}`, route => route.fulfill({ headers: { ETag: sent ? '"4"' : '"3"' }, json: { tenantId: tenant, canEdit: true, data: { ...proposal, revision: sent ? 4 : 3, status: sent ? "sent" : "draft" }, items: [], versions: [proposal] } }))
  await page.route(`**/api/erp/proposals/${record}/email`, route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { tenantId: tenant, recipient: "cliente@example.test", canSend: true, emailReady: true, deliveries: [] } })
    sends++; sent = true
    expect(route.request().headers()["if-match"]).toBe('"3"')
    expect(route.request().headers()["idempotency-key"]).toMatch(/^[a-f0-9-]{36}$/)
    expect(route.request().postDataJSON()).toMatchObject({ recipient: "cliente@example.test", subject: "Proposta 2 · versão 1", message: "Confira a proposta em anexo." })
    return route.fulfill({ headers: { ETag: '"4"' }, json: { tenantId: tenant, revision: 4, delivery: { id: record, recipient: "cliente@example.test", status: "sent", createdAt: "2026-11-11T12:00:00Z" } } })
  })
  await page.setViewportSize({ width, height: 852 })
  await page.goto(`/vendas/propostas/${record}`)
  await expect(page.getByRole("button", { name: "Imprimir / salvar PDF", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Enviar por e-mail", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByLabel("Destinatário", { exact: true })).toHaveValue("cliente@example.test")
  expect(sends).toBe(0)
  await dialog.getByLabel("Mensagem", { exact: true }).fill("Confira a proposta em anexo.")
  await dialog.getByRole("button", { name: "Enviar e-mail com anexo", exact: true }).click()
  await expect(dialog.getByRole("status")).toContainText("Aceito pelo servidor")
  await expect(dialog.getByRole("button", { name: "Enviar e-mail com anexo", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Marcar como enviada", exact: true })).toHaveCount(0)
  expect(sends).toBe(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

for (const mode of ["busy", "uncertain"] as const) test(`proposta preserva o comando ${mode} ao fechar e reabrir o envio`, async ({ page }) => {
  const keys: string[] = []
  let release: () => void = () => {}
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route(`**/api/erp/proposals/${record}/email`, async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { tenantId: tenant, recipient: "cliente@example.test", canSend: true, emailReady: true, deliveries: [] } })
    keys.push(route.request().headers()["idempotency-key"])
    if (keys.length === 1 && mode === "uncertain") return route.abort("failed")
    if (mode === "busy") await pending
    return route.fulfill({ headers: { ETag: '"4"' }, json: { tenantId: tenant, revision: 4, delivery: { id: record, recipient: "cliente@example.test", status: "sent", createdAt: "2026-11-11T12:00:00Z" } } })
  })
  try {
    await page.goto(`/vendas/propostas/${record}`)
    await page.getByRole("button", { name: "Enviar por e-mail", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("button", { name: "Enviar e-mail com anexo", exact: true }).click()
    await expect.poll(() => keys.length).toBe(1)
    if (mode === "uncertain") await expect(dialog.getByRole("button", { name: "Consultar resultado do envio", exact: true })).toBeEnabled()
    await dialog.getByRole("button", { name: "Close", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.getByRole("button", { name: "Enviar por e-mail", exact: true }).click()
    if (mode === "busy") {
      await expect(dialog.getByRole("button", { name: "Confirmando envio…", exact: true })).toBeDisabled()
      release()
    } else {
      await expect(dialog.getByRole("button", { name: "Consultar resultado do envio", exact: true })).toBeEnabled()
      await dialog.getByRole("button", { name: "Consultar resultado do envio", exact: true }).click()
      expect(keys).toEqual([keys[0], keys[0]])
    }
    await expect(dialog.getByRole("status")).toContainText("Aceito pelo servidor")
    await expect(dialog.getByRole("button", { name: "Enviar e-mail com anexo", exact: true })).toBeDisabled()
    expect(keys).toHaveLength(mode === "busy" ? 1 : 2)
  } finally { release() }
})

for (const mode of ["unconfigured", "readonly", "uncertain", "history"] as const) test(`proposta ${mode} impede envio e explica a pendência`, async ({ page }) => {
  if (mode === "history") await page.route(`**/api/erp/proposals/${record}`, route => route.fulfill({ headers: { ETag: '"3"' }, json: { tenantId: tenant, canEdit: true, data: { ...proposal, isCurrent: false }, items: [], versions: [proposal] } }))
  let sends = 0
  await page.route(`**/api/erp/proposals/${record}/email`, route => {
    if (route.request().method() !== "GET") sends++
    return route.fulfill({ json: { tenantId: tenant, recipient: "cliente@example.test", canSend: mode !== "readonly", emailReady: mode !== "unconfigured", deliveries: mode === "uncertain" ? [{ id: record, recipient: "cliente@example.test", status: "uncertain", createdAt: "2026-11-11T12:00:00Z" }] : [] } })
  })
  await page.goto(`/vendas/propostas/${record}`)
  const button = page.getByRole("button", { name: "Enviar por e-mail", exact: true })
  if (mode === "history") { await expect(button).toBeDisabled(); await expect(button).toHaveAttribute("title", /versão atual/); return }
  await button.click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText(mode === "unconfigured" ? /ainda não está configurado/ : mode === "readonly" ? /Envio indisponível/ : /Há um envio sem confirmação/)).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Enviar e-mail com anexo", exact: true })).toBeDisabled()
  expect(sends).toBe(0)
})

test("BFF da proposta preserva revisão e empresa e rejeita consulta e origem estranhas", async ({ context, baseURL }) => {
  const requests: { url: string | undefined; revision: string | string[] | undefined; key: string | string[] | undefined; tenant: string | string[] | undefined }[] = []
  const server = createServer((request, response) => {
    requests.push({ url: request.url, revision: request.headers["if-match"], key: request.headers["idempotency-key"], tenant: request.headers["x-tenant-id"] })
    response.writeHead(200, { "Content-Type": "application/json", ETag: '"4"' }); response.end(JSON.stringify({ tenantId: tenant }))
  })
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(33119, "127.0.0.1", resolve) })
  const path = `/api/erp/proposals/${record}/email`
  const headers = { Origin: baseURL!, "X-Tenant-Id": tenant, "If-Match": '"3"', "Idempotency-Key": record }
  try {
    expect((await context.request.get(path)).status()).toBe(200)
    expect((await context.request.post(path, { headers, data: { recipient: "cliente@example.test", subject: "Proposta", message: "Confira." } })).status()).toBe(200)
    expect(requests[1]).toEqual({ url: `/api/v1/proposals/${record}/email`, revision: '"3"', key: record, tenant })
    expect((await context.request.get(`${path}?version=1`)).status()).toBe(400)
    expect((await context.request.post(path, { headers: { ...headers, Origin: "https://other.example.test" }, data: {} })).status()).toBe(403)
    expect((await context.request.post(path, { headers: { ...headers, "X-Tenant-Id": record }, data: {} })).status()).toBe(409)
    expect(requests).toHaveLength(2)
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})
