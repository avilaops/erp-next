import { expect, test, type BrowserContext } from "@playwright/test"
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto"

const origin = process.env.ERP_TEST_WEB_ORIGIN || "http://127.0.0.1:3202"
const tenant = "11111111-1111-4111-8111-111111111111"
const headers = { Origin: origin, "X-Tenant-Id": tenant }

async function session(context: BrowserContext, reader = false) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(process.env.ERP_SESSION_SECRET!).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: reader ? "fixture-reader-token" : "fixture-editor-token", tenantId: tenant, expiresAt: Date.now() + 3600_000 })), cipher.final()])
  await context.addCookies([{ name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" }])
}

test("propostas reais persistem no BFF, preservam versões e geram somente um pedido em rascunho", async ({ page, context, browser }) => {
  test.setTimeout(120_000)
  await session(context)
  const existing = await context.request.get("/api/erp/parties?q=11444777000161")
  expect(existing.status()).toBe(200)
  let customerName = (await existing.json()).data[0]?.legalName as string | undefined
  if (!customerName) {
    customerName = "Cliente de propostas do navegador"
    const customer = await context.request.post("/api/erp/parties", { headers: { ...headers, "Idempotency-Key": randomUUID() }, data: { personType: "juridica", legalName: customerName, taxId: "11444777000161", tradeName: null, email: null, phone: null, isCustomer: true, isSupplier: false, status: "active" } })
    expect(customer.status()).toBe(201)
  }
  const receivablesBefore = (await (await context.request.get("/api/erp/receivables")).json()).total
  const product = await context.request.post("/api/erp/products", { headers: { ...headers, "Idempotency-Key": randomUUID() }, data: { sku: `PROP-${randomUUID()}`, name: "Equipamento da proposta", unit: "UN", basePrice: "120.00", ncm: null, cest: null, status: "active", structureColors: ["Preto"], upholsteryColors: ["Azul"] } })
  expect(product.status()).toBe(201)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/vendas/propostas/novo")
  await page.getByLabel("Buscar cliente", { exact: true }).fill("11444777000161")
  await page.getByRole("button", { name: "Pesquisar cliente", exact: true }).click()
  await page.getByRole("button", { name: `Selecionar ${customerName}`, exact: true }).click()
  await page.getByLabel("Buscar produto", { exact: true }).fill("Equipamento da proposta")
  await page.getByRole("button", { name: "Pesquisar produto", exact: true }).click()
  await page.getByRole("button", { name: /Selecionar Equipamento da proposta/ }).click()
  await page.getByLabel("Preço unitário de Equipamento da proposta", { exact: true }).fill("100,00")
  await page.getByLabel("Quantidade de Equipamento da proposta", { exact: true }).fill("2")
  await page.getByLabel("Estrutura de Equipamento da proposta", { exact: true }).selectOption("Preto")
  await page.getByLabel("Estofado de Equipamento da proposta", { exact: true }).selectOption("Azul")
  await page.getByLabel("Validade da proposta", { exact: true }).fill("2100-01-01")
  await page.getByLabel("Condições de pagamento", { exact: true }).fill("À vista")
  await page.getByLabel("Condições de entrega", { exact: true }).fill("Retirada pelo cliente")
  await page.getByRole("button", { name: "Salvar proposta", exact: true }).click()
  await expect(page).toHaveURL(/\/vendas\/propostas\/[a-f0-9-]{36}$/)
  const id = page.url().split("/").at(-1)!
  const resource = `/api/erp/proposals/${id}`
  const read = async () => { const response = await context.request.get(resource); expect(response.status()).toBe(200); return response.json() }
  await page.reload()
  await expect(page.getByText("Total: R$ 200,00", { exact: true })).toBeVisible()
  expect((await read()).items[0]).toMatchObject({ unitPrice: "100.00", catalogPrice: "120.00", structureColor: "Preto", upholsteryColor: "Azul" })
  await page.getByRole("button", { name: "Marcar como enviada", exact: true }).click()
  await page.getByRole("button", { name: "Confirmar operação", exact: true }).click()
  await expect.poll(async () => (await read()).data.status).toBe("sent")
  await page.getByRole("button", { name: "Criar nova versão", exact: true }).click()
  await page.getByRole("button", { name: "Confirmar operação", exact: true }).click()
  await expect.poll(async () => (await read()).data.version).toBe(2)
  await page.getByRole("link", { name: "Editar rascunho", exact: true }).click()
  await page.getByLabel("Condições de pagamento", { exact: true }).fill("Pagamento na retirada")
  await page.getByRole("button", { name: "Salvar proposta", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/vendas/propostas/${id}$`))
  const historical = await context.request.get(`${resource}?version=1`)
  expect((await historical.json()).data.paymentTerms).toBe("À vista")
  await page.getByRole("button", { name: "Marcar como enviada", exact: true }).click()
  await page.getByRole("button", { name: "Confirmar operação", exact: true }).click()
  await expect.poll(async () => (await read()).data.status).toBe("sent")
  await page.getByRole("button", { name: "Registrar aceite", exact: true }).click()
  await page.getByRole("button", { name: "Confirmar operação", exact: true }).click()
  await expect.poll(async () => (await read()).data.status).toBe("accepted")
  await page.getByRole("button", { name: "Gerar pedido em rascunho", exact: true }).click()
  await page.getByLabel("Vencimento do pedido", { exact: true }).fill("2100-01-10")
  await page.getByRole("button", { name: "Confirmar operação", exact: true }).click()
  await expect(page.getByRole("link", { name: "Consultar pedido gerado", exact: true })).toBeVisible()
  const converted = await read()
  const order = await context.request.get(`/api/erp/orders/${converted.data.orderId}`)
  expect((await order.json()).data).toMatchObject({ status: "draft", amount: "200.00" })
  expect((await (await context.request.get("/api/erp/receivables")).json()).total).toBe(receivablesBefore)
  await page.screenshot({ path: test.info().outputPath("proposal-persisted-mobile.png"), fullPage: true })
  await page.pdf({ path: test.info().outputPath("proposal-commercial.pdf"), format: "A4", printBackground: true })
  const reader = await browser.newContext({ baseURL: origin })
  try {
    await session(reader, true)
    expect((await reader.request.get(resource)).status()).toBe(200)
    const rejected = await reader.request.post(`${resource}/cancel`, { headers: { ...headers, "Idempotency-Key": randomUUID(), "If-Match": `"${converted.data.revision}"` }, data: { reason: "Tentativa sem permissão" } })
    expect(rejected.status()).toBe(403)
  } finally { await reader.close() }
  const cancelledDraft = await context.request.post("/api/erp/proposals", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: { customerId: converted.data.customerId, validUntil: "2100-01-01", paymentTerms: "À vista", deliveryTerms: "Retirada pelo cliente", notes: "", items: [{ productId: converted.items[0].productId, quantity: "1.000000", unitPrice: "120.00", structureColor: "Preto", upholsteryColor: "Azul" }] },
  })
  expect(cancelledDraft.status()).toBe(201)
  const cancelledId = (await cancelledDraft.json()).data.id
  await page.goto(`/vendas/propostas/${cancelledId}`)
  await page.getByRole("button", { name: "Cancelar proposta", exact: true }).click()
  await page.getByLabel("Motivo", { exact: true }).fill("Cliente desistiu antes do envio")
  await page.getByRole("button", { name: "Confirmar operação", exact: true }).click()
  await expect(page.getByText("Motivo registrado: Cliente desistiu antes do envio", { exact: true })).toBeVisible()
  await page.goto("/vendas/propostas")
  await page.getByRole("combobox", { name: "Situação", exact: true }).selectOption("cancelled")
  await page.getByRole("button", { name: "Pesquisar propostas", exact: true }).click()
  await expect(page.locator(`a[href="/vendas/propostas/${cancelledId}"]`)).toBeVisible()
  await expect(page.locator(`a[href="/vendas/propostas/${id}"]`)).toHaveCount(0)
})
