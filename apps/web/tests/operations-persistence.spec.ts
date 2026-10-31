import { test, expect, type BrowserContext, type Page } from "@playwright/test"
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
async function seed(context: BrowserContext, name: string) {
  const request = context.request
  const list = await request.get("/api/erp/parties?q=11444777000161")
  let customer = (await list.json()).data[0]?.id as string | undefined
  if (!customer) {
    const created = await request.post("/api/erp/parties", { headers: { ...headers, "Idempotency-Key": randomUUID() }, data: { personType: "juridica", legalName: "Cliente operacional do navegador", tradeName: null, taxId: "11444777000161", email: null, phone: null, isCustomer: true, isSupplier: false, status: "active" } })
    expect(created.status()).toBe(201); customer = (await created.json()).data.id
  }
  const sku = `OPS-${randomUUID()}`
  const created = await request.post("/api/erp/products", { headers: { ...headers, "Idempotency-Key": randomUUID() }, data: { sku, name, unit: "UN", basePrice: "0.33", ncm: null, cest: null, status: "active" } })
  expect(created.status()).toBe(201)
  const product = (await created.json()).data.id as string
  const receipt = await request.post("/api/erp/stock/movements", { headers: { ...headers, "Idempotency-Key": randomUUID() }, data: { productId: product, direction: "receipt", quantity: "10.000000", reason: "Estoque inicial operacional", reversesId: null } })
  expect(receipt.status()).toBe(201)
  return { customer: customer!, product, sku }
}
async function draft(context: BrowserContext, customer: string, product: string, quantity: string) {
  const response = await context.request.post("/api/erp/orders", { headers: { ...headers, "Idempotency-Key": randomUUID() }, data: { customerId: customer, dueDate: "2026-11-27", items: [{ productId: product, quantity }] } })
  expect(response.status()).toBe(201); return (await response.json()).data.id as string
}
async function action(context: BrowserContext, id: string, operation: string, revision: number) {
  return context.request.post(`/api/erp/orders/${id}/${operation}`, { headers: { ...headers, "Idempotency-Key": randomUUID(), "If-Match": `"${revision}"` }, data: {} })
}
async function account(context: BrowserContext, orderId: string) {
  const response = await context.request.get("/api/erp/receivables?limit=100")
  const result = (await response.json()).data.find((value: { orderId: string }) => value.orderId === orderId)
  expect(result).toBeTruthy(); return result.id as string
}
async function fillPayment(page: Page, reference: string) {
  await page.getByRole("textbox", { name: "Valor declarado (vírgula ou ponto)", exact: true }).fill("0.99")
  await page.getByLabel("Data do recebimento", { exact: true }).fill("2026-10-27")
  await page.getByRole("textbox", { name: "Referência do recebimento", exact: true }).fill(reference)
}

test("recebimentos parciais preservam saldo, repetem resposta perdida e estornam o lançamento escolhido", async ({ page, context }) => {
  await session(context)
  const data = await seed(context, "Produto com recebimentos parciais")
  const orderId = await draft(context, data.customer, data.product, "3.000000")
  expect((await action(context, orderId, "confirm", 1)).status()).toBe(200)
  expect((await action(context, orderId, "complete", 2)).status()).toBe(200)
  const id = await account(context, orderId)
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto(`/financeiro/contas-receber/${id}`)
  await fillPayment(page, "Primeira parte declarada")
  await page.getByRole("textbox", { name: "Valor declarado (vírgula ou ponto)", exact: true }).fill("0.33")
  let lost = false
  const requests: { key: string; body: string | null }[] = []
  await page.route(`**/api/erp/receivables/${id}/payments`, async route => {
    requests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() })
    if (!lost) { const committed = await route.fetch(); expect(committed.status()).toBe(200); lost = true; return route.abort("failed") }
    return route.continue()
  })
  await page.getByRole("button", { name: "Confirmar recebimento declarado", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Referência do recebimento", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Repetir confirmação financeira", exact: true }).click()
  await expect(page.getByText("Saldo restante: R$ 0,66", { exact: true })).toBeVisible()
  await expect(page.getByText("Situação: Recebimento parcial declarado", { exact: true })).toBeVisible()
  expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1])
  await page.unroute(`**/api/erp/receivables/${id}/payments`)
  const partial = await (await context.request.get(`/api/erp/receivables/${id}`)).json()
  expect(partial.payments).toHaveLength(1)
  const firstId = partial.payments[0].id as string
  await fillPayment(page, "Segunda parte declarada")
  await page.getByRole("textbox", { name: "Valor declarado (vírgula ou ponto)", exact: true }).fill("0.66")
  await page.getByRole("button", { name: "Confirmar recebimento declarado", exact: true }).click()
  await expect(page.getByText("Saldo restante: R$ 0,00", { exact: true })).toBeVisible()
  await expect(page.getByText("Recebido declarado: R$ 0,99", { exact: true })).toBeVisible()
  await page.getByLabel("Recebimento a estornar", { exact: true }).selectOption(firstId)
  await page.getByLabel("Data do estorno", { exact: true }).fill("2026-10-28")
  await page.getByRole("textbox", { name: "Motivo do estorno", exact: true }).fill("Correção da primeira parte")
  await page.getByRole("button", { name: "Confirmar estorno do recebimento", exact: true }).click()
  await expect(page.getByText("Saldo restante: R$ 0,33", { exact: true })).toBeVisible()
  await expect(page.getByText("Recebido declarado: R$ 0,66", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: `Estornar recebimento ${firstId}`, exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.screenshot({ path: "../../evidencias/screenshots/erp-recebimento-parcial-mobile.png", fullPage: true })
  await page.reload()
  await expect(page.getByText("Saldo restante: R$ 0,33", { exact: true })).toBeVisible()
  const final = await (await context.request.get(`/api/erp/receivables/${id}`)).json()
  expect(final.payments).toHaveLength(3)
  expect(final.payments[2].amount).toBe("0.33"); expect(final.payments[2].reversesId).toBe(firstId)
})

test("edição de rascunho preserva preço registrado, repete PUT perdido e persiste após recarregar", async ({ page, context }) => {
  await session(context)
  const name = "Produto do rascunho editável"
  const data = await seed(context, name)
  const id = await draft(context, data.customer, data.product, "3.000000")
  const price = await context.request.put(`/api/erp/products/${data.product}`, {
    headers: { ...headers, "If-Match": '"1"' },
    data: { sku: data.sku, name: "Nome novo no catálogo", unit: "UN", basePrice: "100.00", ncm: null, cest: null, status: "active" },
  })
  expect(price.status()).toBe(200)
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto(`/vendas/pedidos/${id}`)
  await page.getByRole("link", { name: "Editar rascunho", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Editar rascunho do pedido", exact: true })).toBeVisible()
  const input = page.getByRole("textbox", { name: `Quantidade de ${name}`, exact: true })
  await expect(input).toHaveValue("3.000000")
  await expect(page.getByText(/Preço registrado: R\$ 0,33/)).toBeVisible()
  await input.fill("4.5")
  await page.getByLabel("Vencimento da conta a receber", { exact: true }).fill("2026-12-30")
  let lost = false
  const requests: { method: string; key: string; body: string | null }[] = []
  await page.route(`**/api/erp/orders/${id}`, async route => {
    if (route.request().method() !== "PUT") return route.continue()
    requests.push({ method: route.request().method(), key: route.request().headers()["idempotency-key"], body: route.request().postData() })
    if (!lost) { const committed = await route.fetch(); expect(committed.status()).toBe(200); lost = true; return route.abort("failed") }
    return route.continue()
  })
  await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click()
  await expect(input).toBeDisabled()
  await page.getByRole("button", { name: "Conferir alteração do pedido", exact: true }).click()
  await expect(page).toHaveURL(`${origin}/vendas/pedidos/${id}`)
  await expect(page.getByText("Total comercial: R$ 1,49", { exact: true })).toBeVisible()
  expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]); expect(requests[0].method).toBe("PUT")
  await page.reload()
  await expect(page.getByText("Quantidade: 4.500000 UN", { exact: true })).toBeVisible()
  await expect(page.getByText("Vencimento: 2026-12-30", { exact: true })).toBeVisible()
  await expect(page.getByText("Unitário: R$ 0,33", { exact: true })).toBeVisible()
  const stock = await context.request.get(`/api/erp/stock?q=${data.sku}`)
  const balance = (await stock.json()).data[0]
  expect(balance.quantity).toBe("10.000000"); expect(balance.reserved).toBe("0.000000")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.screenshot({ path: "../../evidencias/screenshots/erp-pedido-editado-mobile.png", fullPage: true })
})

test("editor preserva alteração recusada, exige confirmação para recarregar e bloqueia reservado e consulta", async ({ page, context }) => {
  await session(context)
  const name = "Produto do conflito no editor"
  const data = await seed(context, name)
  const id = await draft(context, data.customer, data.product, "2.000000")
  const inputData = (quantity: string) => ({ customerId: data.customer, dueDate: "2026-11-27", items: [{ productId: data.product, quantity }] })
  await page.goto(`/vendas/pedidos/${id}/editar`)
  const quantity = page.getByRole("textbox", { name: `Quantidade de ${name}`, exact: true })
  await quantity.fill("4")
  const remote = await context.request.put(`/api/erp/orders/${id}`, { headers: { ...headers, "If-Match": '"1"', "Idempotency-Key": randomUUID() }, data: inputData("3.000000") })
  expect(remote.status()).toBe(200)
  await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Outra pessoa alterou" })).toBeVisible()
  await expect(quantity).toHaveValue("4")
  page.once("dialog", dialog => dialog.dismiss())
  await page.getByRole("button", { name: "Recarregar rascunho", exact: true }).click()
  await expect(quantity).toHaveValue("4")
  page.once("dialog", dialog => dialog.accept())
  await page.getByRole("button", { name: "Recarregar rascunho", exact: true }).click()
  await expect(quantity).toHaveValue("3.000000")
  expect((await action(context, id, "confirm", 2)).status()).toBe(200)
  await page.reload()
  await expect(page.getByRole("status")).toContainText("não está em rascunho")
  await expect(page.getByRole("button", { name: "Salvar rascunho", exact: true })).toHaveCount(0)
  await session(context, true)
  await page.reload()
  await expect(page.getByRole("status")).toContainText("Somente consulta")
  expect((await context.request.put(`/api/erp/orders/${id}`, { headers: { ...headers, "If-Match": '"3"', "Idempotency-Key": randomUUID() }, data: inputData("1.000000") })).status()).toBe(403)
})

test("central de ajuda abre orientação por teclado, filtra e oferece destinos reais", async ({ page }) => {
  await page.goto("/ajuda")
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "Pedidos e propostas", exact: true }) })
  const guidance = card.getByText(/Confirmar reserva estoque/)
  await expect(guidance).not.toBeVisible()
  await card.locator("summary").focus()
  await page.keyboard.press("Enter")
  await expect(guidance).toBeVisible()
  await expect(card.getByRole("link", { name: "Pedidos de venda", exact: true })).toHaveAttribute("href", "/vendas/pedidos")
  await page.getByRole("textbox", { name: "Buscar na ajuda", exact: true }).fill("termo inexistente de orientação")
  await expect(page.getByRole("status")).toContainText("Nenhuma orientação encontrada")
  await page.getByRole("textbox", { name: "Buscar na ajuda", exact: true }).fill("Pedidos e propostas")
  await expect(page.locator("article")).toHaveCount(1)
})

test("pedido reserva estoque, conclui, gera conta e registra recebimento e estorno no navegador", async ({ page, context }) => {
  await session(context)
  const data = await seed(context, "Produto do pedido integral")
  await page.setViewportSize({ width: 375, height: 844 })
  await page.goto("/vendas/pedidos/novo")
  await page.getByRole("textbox", { name: "Buscar cliente", exact: true }).fill("11444777000161")
  await page.getByRole("button", { name: "Pesquisar cliente", exact: true }).click()
  await page.getByRole("button", { name: "Selecionar Cliente operacional do navegador", exact: true }).click()
  await page.getByRole("textbox", { name: "Buscar produto", exact: true }).fill(data.sku)
  await page.getByRole("button", { name: "Pesquisar produto", exact: true }).click()
  await page.getByRole("button", { name: /^Selecionar Produto do pedido integral/ }).click()
  await page.getByLabel("Vencimento da conta a receber", { exact: true }).fill("2026-11-27")
  await page.getByRole("textbox", { name: "Quantidade de Produto do pedido integral", exact: true }).fill("3")
  await page.getByRole("button", { name: "Criar rascunho", exact: true }).click()
  await expect(page.getByText("Total comercial: R$ 0,99", { exact: true })).toBeVisible()
  const orderId = new URL(page.url()).pathname.split("/").at(-1)!
  await page.getByRole("button", { name: "Confirmar e reservar estoque", exact: true }).click()
  await expect(page.getByText("Situação: Reservado", { exact: true })).toBeVisible()
  const stock = await context.request.get(`/api/erp/stock?q=${data.sku}`)
  expect((await stock.json()).data[0].reserved).toBe("3.000000")
  page.once("dialog", dialog => dialog.accept())
  await page.getByRole("button", { name: "Concluir e gerar conta a receber", exact: true }).click()
  await expect(page.getByText("Situação: Concluído", { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: "../../evidencias/screenshots/erp-pedido-mobile-persistente.png", fullPage: true })
  const receivable = await account(context, orderId)
  await page.goto(`/financeiro/contas-receber/${receivable}`)
  await fillPayment(page, "Recebimento declarado no navegador")
  await page.getByRole("textbox", { name: "Valor declarado (vírgula ou ponto)", exact: true }).fill("1.00")
  await page.getByRole("button", { name: "Confirmar recebimento declarado", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "saldo restante" })).toBeVisible()
  await page.getByRole("textbox", { name: "Valor declarado (vírgula ou ponto)", exact: true }).fill("0.99")
  let lost = false; const keys: string[] = []
  await page.route(`**/api/erp/receivables/${receivable}/payments`, async route => {
    keys.push(route.request().headers()["idempotency-key"])
    if (!lost) { const committed = await route.fetch(); expect(committed.status()).toBe(200); lost = true; return route.abort("failed") }
    return route.continue()
  })
  await page.getByRole("button", { name: "Confirmar recebimento declarado", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Referência do recebimento", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Repetir confirmação financeira", exact: true }).click()
  await expect(page.getByText("Situação: Recebimento declarado", { exact: true })).toBeVisible()
  expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1])
  await page.getByLabel("Data do estorno", { exact: true }).fill("2026-10-28")
  await page.getByRole("textbox", { name: "Motivo do estorno", exact: true }).fill("Correção do recebimento declarado")
  await page.getByRole("button", { name: "Confirmar estorno do recebimento", exact: true }).click()
  await expect(page.getByText("Situação: Em aberto", { exact: true })).toBeVisible()
  const detail = await context.request.get(`/api/erp/receivables/${receivable}`)
  const history = (await detail.json()).payments
  expect(history).toHaveLength(2); expect(history[1].reversesId).toBe(history[0].id)
  for (const width of [320, 375, 440]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    const submit = await page.getByRole("button", { name: "Confirmar recebimento declarado", exact: true }).boundingBox()
    expect(submit!.x + submit!.width).toBeLessThanOrEqual(width)
  }
  await page.setViewportSize({ width: 375, height: 844 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: "../../evidencias/screenshots/erp-financeiro-mobile-persistente.png", fullPage: true })
})

test("duas confirmações disputam saldo e o cancelamento libera a reserva", async ({ page, context }) => {
  await session(context)
  const data = await seed(context, "Produto de reserva concorrente")
  const first = await draft(context, data.customer, data.product, "7.000000")
  const second = await draft(context, data.customer, data.product, "7.000000")
  const responses = await Promise.all([action(context, first, "confirm", 1), action(context, second, "confirm", 1)])
  expect(responses.map(response => response.status()).sort()).toEqual([200, 409])
  const winner = responses[0].status() === 200 ? first : second
  const manual = await context.request.post("/api/erp/stock/movements", { headers: { ...headers, "Idempotency-Key": randomUUID() }, data: { productId: data.product, direction: "issue", quantity: "4.000000", reason: "Tentativa sobre saldo reservado", reversesId: null } })
  expect(manual.status()).toBe(409)
  await page.goto(`/vendas/pedidos/${winner}`)
  await expect(page.getByText("Situação: Reservado", { exact: true })).toBeVisible()
  page.once("dialog", dialog => dialog.accept())
  await page.getByRole("button", { name: "Cancelar pedido", exact: true }).click()
  await expect(page.getByText("Situação: Cancelado", { exact: true })).toBeVisible()
  const stock = await context.request.get(`/api/erp/stock?q=${data.sku}`)
  const value = (await stock.json()).data[0]
  expect(value.reserved).toBe("0.000000"); expect(value.available).toBe("10.000000")
})

test("resposta perdida da reserva usa a mesma chave e não reserva duas vezes", async ({ page, context }) => {
  await session(context)
  const data = await seed(context, "Produto de confirmação interrompida do pedido")
  const id = await draft(context, data.customer, data.product, "3.000000")
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto(`/vendas/pedidos/${id}`)
  let lost = false; const keys: string[] = []
  await page.route(`**/api/erp/orders/${id}/confirm`, async route => {
    keys.push(route.request().headers()["idempotency-key"])
    if (!lost) { const committed = await route.fetch(); expect(committed.status()).toBe(200); lost = true; return route.abort("failed") }
    return route.continue()
  })
  await page.getByRole("button", { name: "Confirmar e reservar estoque", exact: true }).click()
  await page.getByRole("button", { name: "Repetir confirmação do pedido", exact: true }).click()
  await expect(page.getByText("Situação: Reservado", { exact: true })).toBeVisible()
  expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1])
  const stock = await context.request.get(`/api/erp/stock?q=${data.sku}`)
  expect((await stock.json()).data[0].reserved).toBe("3.000000")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test("recebimento remoto gera conflito de revisão e usuário de consulta não grava", async ({ page, context }) => {
  await session(context)
  const data = await seed(context, "Produto do recebimento revisado")
  const id = await draft(context, data.customer, data.product, "3.000000")
  expect((await action(context, id, "confirm", 1)).status()).toBe(200)
  expect((await action(context, id, "complete", 2)).status()).toBe(200)
  const receivable = await account(context, id)
  await page.goto(`/financeiro/contas-receber/${receivable}`)
  await fillPayment(page, "Edição local do recebimento")
  const paid = await context.request.post(`/api/erp/receivables/${receivable}/payments`, { headers: { ...headers, "If-Match": '"1"', "Idempotency-Key": randomUUID() }, data: { amount: "0.99", method: "cash", reference: "Recebimento remoto declarado", occurredOn: "2026-10-27" } })
  expect(paid.status()).toBe(200)
  await page.getByRole("button", { name: "Confirmar recebimento declarado", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Outra pessoa alterou" })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Referência do recebimento", exact: true })).toHaveValue("Edição local do recebimento")
  page.once("dialog", dialog => dialog.accept())
  await page.getByRole("button", { name: "Recarregar conta", exact: true }).click()
  await expect(page.getByText("Situação: Recebimento declarado", { exact: true })).toBeVisible()
  await session(context, true)
  await page.reload()
  await expect(page.getByText("Somente consulta.", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Confirmar estorno do recebimento", exact: true })).toHaveCount(0)
  expect((await action(context, id, "cancel", 3)).status()).toBe(403)
  expect((await context.request.post(`/api/erp/orders/${id}/erase`, { headers, data: {} })).status()).toBe(400)
})
