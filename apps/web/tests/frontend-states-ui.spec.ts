import { expect, test } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { origin, secret } from "../playwright.danfe.config"

const dashboard = { tenantId: "11111111-1111-4111-8111-111111111111", period: "6M", startDate: "2026-05-05", endDate: "2026-11-05", sales: { orders: 3, cancelled: 1, amount: "1500.00", average: "500.00" }, salesSeries: [{ month: "2026-11", orders: 3, amount: "1500.00", average: "500.00" }], receivables: "820.50", purchasePayables: "250.00", products: 12, customers: 4 }

const tenant = "11111111-1111-4111-8111-111111111111"
const record = "22222222-2222-4222-8222-222222222222"
test.beforeEach(async ({ context }) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "states-fixture", tenantId: tenant, expiresAt: Date.now() + 3600_000 })), cipher.final()])
  await context.addCookies([{ name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" }])
  await context.route("**/api/erp/**", route => route.fulfill({ status: 503, json: { title: "Consulta indisponível no teste" } }))
})

test("dashboard inválido mostra 404 em português com saída", async ({ page }) => {
  await page.goto("/dashboards/nao-existe")
  await expect(page.getByRole("heading", { name: "Página não encontrada", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Dashboard de vendas", exact: true })).toHaveCount(0)
  await page.getByRole("link", { name: "Voltar ao início", exact: true }).click()
  await expect(page).toHaveURL(origin + "/")
})

test("dashboard usa a resposta da empresa e os módulos cabem na largura disponível", async ({ page }, testInfo) => {
  await page.route("**/api/erp/dashboard?*", route => route.fulfill({ json: dashboard }))
  await page.route("**/api/erp/audit", route => route.fulfill({ json: { tenantId: dashboard.tenantId, data: [{ id: "event-1", occurredAt: "2026-11-05T12:00:00Z", actor: "Operador de teste", action: "order.created", entityType: "sales_order" }], nextCursor: null } }))
  await page.goto("/")
  await expect(page.getByRole("link", { name: /Saldo a receber/ }).filter({ visible: true })).toContainText("R$ 820,50")
  await expect(page.getByRole("complementary", { name: "Atividade recente" })).toContainText("order.created")
  for (const width of [390, 907, 1280, 1600]) {
    await page.setViewportSize({ width, height: 1000 })
    const cards = page.getByRole("region", { name: "Módulos", exact: true }).getByRole("link")
    await expect(cards).toHaveCount(9)
    for (const card of await cards.all()) {
      const box = await card.boundingBox()
      expect(box!.width).toBeGreaterThanOrEqual(250)
      expect(await card.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const activity = await page.getByRole("complementary", { name: "Atividade recente" }).boundingBox()
    expect(activity!.height).toBeLessThan(400)
    await testInfo.attach(`dashboard-real-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" })
  }
  await page.goto("/dashboards/vendas")
  await expect(page.getByRole("table")).toContainText("R$ 1.500,00")
  await page.getByRole("combobox", { name: "Período do dashboard" }).selectOption("30D")
  await expect.poll(() => page.locator("main").getByText("R$ 1.500,00", { exact: true }).count()).toBeGreaterThan(0)
})

test("metas e prévias não apresentam números fixos nem controles simulados", async ({ page }, testInfo) => {
  await page.goto("/dashboards/metas")
  await expect(page.getByRole("heading", { name: "Metas ainda não cadastradas", exact: true })).toBeVisible()
  await expect(page.locator("main").getByText(/220 mil|83,9%|35,4 mil|Tendência positiva/)).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Exportar visão" })).toHaveCount(0)
  await expect(page.getByRole("combobox", { name: "Período do dashboard" })).toHaveCount(0)
  await testInfo.attach("metas-sem-dados-inventados", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" })
  await page.goto("/preferencias/integracoes")
  await expect(page.getByRole("heading", { name: "Integrações", exact: true })).toBeVisible()
  await expect(page.getByText("Ávila Lojas", { exact: true })).toBeVisible()
  await expect(page.locator("main").getByText(/4821|10:42|Conexão saudável|Sincronizar estoque/)).toHaveCount(0)
  for (const path of ["/eventos", "/novidades", "/vendas/pdv", "/financeiro/relatorios", "/logistica/envios", "/servicos/ordens"]) {
    await page.goto(path)
    await expect(page.getByRole("heading", { name: "Funcionalidade indisponível", exact: true })).toBeVisible()
    await expect(page.locator("main button, main table, main input")).toHaveCount(0)
    await expect(page.locator("main").getByText(/R\$|Academia Horizonte|Demonstração|Prévia de interface/)).toHaveCount(0)
  }
})

test("títulos distinguem lista, criação, configuração e dashboard", async ({ page }) => {
  for (const [path, title] of [
    ["/cadastros/produtos", "Produtos"],
    ["/cadastros/produtos/novo", "Novo produto"],
    ["/financeiro/contas-pagar", "Contas a pagar"],
    ["/preferencias/empresa", "Empresa"],
    ["/dashboards/vendas", "Dashboard de vendas"],
  ]) {
    await page.goto(path)
    await expect(page).toHaveTitle(title + " · Avila ERP")
  }
})

test("importação de produtos aceita CSV sem inventar resultados", async ({ page }) => {
  await page.goto("/vendas/importacao")
  await expect(page.getByRole("heading", { name: "Importação indisponível", exact: true })).toBeVisible()
  await expect(page.locator('input[type="file"]')).toHaveCount(0)
  await page.goto("/preferencias/dados/importacao")
  await expect(page.getByRole("heading", { name: "Importação de produtos", exact: true })).toBeVisible()
  await expect(page.locator('input[type="file"]')).toHaveAttribute("accept", ".csv,text/csv")
  await expect(page.getByText(/10 pedidos estariam aptos|118 válidas|12 linhas lidas/)).toHaveCount(0)
})

test("funcionalidade sem integração não monta dados ou operações fictícias", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/vendas/pdv")
  await expect(page.getByRole("heading", { name: "Funcionalidade indisponível", exact: true })).toBeVisible()
  await expect(page.locator("main button")).toHaveCount(0)
  await expect(page.locator("main").getByText(/R\$|Academia Horizonte|PV-1048/)).toHaveCount(0)
  await expect(page.getByRole("navigation", { name: "Operações disponíveis" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Suas empresas", exact: true })).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath("indisponivel-mobile.png"), fullPage: true })
})

test("navegação entre funcionalidade indisponível e cadastro preserva as operações reais", async ({ page }) => {
  await page.route("**/api/erp/products?*", route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: [], total: 0 } }))
  await page.goto("/vendas/pdv")
  await expect(page.getByRole("heading", { name: "Funcionalidade indisponível", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Buscar no ERP", exact: true }).click()
  await page.getByRole("dialog").getByRole("combobox").fill("Produtos")
  await page.getByRole("option", { name: /^Produtos\b/ }).click()
  await expect(page.getByRole("heading", { name: "Funcionalidade indisponível", exact: true })).toHaveCount(0)
  await expect(page.locator("main").getByRole("button", { name: "Buscar", exact: true })).toBeEnabled()
  await page.goBack()
  await expect(page.getByRole("heading", { name: "Funcionalidade indisponível", exact: true })).toBeVisible()
  await expect(page.locator("main button")).toHaveCount(0)
})

test("erro inesperado oferece retry e mantém a consulta", async ({ page }) => {
  let broken = true
  await page.route("**/api/erp/products?*", route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: broken ? [null] : [], total: broken ? 1 : 0 } }))
  await page.goto("/cadastros/produtos?q=teste")
  await expect(page.getByRole("heading", { name: "Não foi possível abrir esta tela", exact: true })).toBeVisible()
  broken = false
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Produtos", exact: true })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Buscar nome ou SKU", exact: true })).toHaveValue("teste")
  await expect(page).toHaveURL(origin + "/cadastros/produtos?q=teste")
})

test("rotas inexistentes e integração desconhecida têm 404 contextual", async ({ page }) => {
  for (const path of ["/rota-inexistente-do-teste", "/preferencias/integracoes/nao-existe"]) {
    await page.goto(path)
    await expect(page.getByRole("heading", { name: "Página não encontrada", exact: true })).toBeVisible()
    await expect(page.getByRole("link", { name: "Voltar ao início", exact: true })).toBeVisible()
  }
})

test("configurações mistas preservam tema local e não simulam gravação ou auditoria", async ({ page }) => {
  await page.goto("/preferencias/sistema")
  await page.getByRole("radio", { name: "Escuro", exact: true }).check()
  await page.reload()
  await expect(page.getByRole("radio", { name: "Escuro", exact: true })).toBeChecked()
  await expect(page.locator("main").getByRole("alert")).toContainText("Consulta indisponível no teste")
  await expect(page.getByRole("button", { name: "Salvar preferências", exact: true })).toHaveCount(0)
  for (const select of await page.locator("main select").all()) await expect(select).toBeDisabled()
  await page.goto("/preferencias/seguranca")
  await expect(page.getByRole("heading", { name: "Segurança e auditoria", exact: true })).toBeVisible()
  await expect(page.locator("main").getByRole("alert")).toContainText("Consulta indisponível no teste")
  await expect(page.getByRole("button", { name: "Tentar novamente", exact: true })).toBeEnabled()
  await expect(page.getByLabel("Simular estado")).toHaveCount(0)
  await expect(page.locator("main ol li")).toHaveCount(0)
})

test("estoque aceita seis casas com vírgula e conserva o comando na repetição", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await page.route("**/api/erp/stock?*", route => route.fulfill({ json: { tenantId: tenant, canEdit: true, total: 1, data: [{ productId: record, sku: "DECIMAL", name: "Produto decimal", unit: "UN", status: "active", quantity: "0.000000", reserved: "0.000000", available: "0.000000" }] } }))
  await page.route("**/api/erp/stock/movements?*", route => route.fulfill({ json: { tenantId: tenant, canEdit: true, total: 0, data: [] } }))
  const commands: { body: unknown; key: string | undefined }[] = []
  await page.route("**/api/erp/stock/movements", route => {
    commands.push({ body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] })
    return route.fulfill({ status: 503, json: { title: "Confirmação indisponível no teste" } })
  })
  await page.goto("/estoque/saldos")
  await page.getByRole("button", { name: /^Produto decimal SKU/ }).click()
  await page.getByLabel("Quantidade (vírgula ou ponto)", { exact: true }).fill("10,000001")
  await page.getByLabel("Motivo", { exact: true }).fill("Conferência decimal")
  await page.getByRole("button", { name: "Confirmar lançamento", exact: true }).click()
  await page.getByRole("button", { name: "Repetir confirmação", exact: true }).click()
  await expect.poll(() => commands.length).toBe(2)
  expect(commands[0].body).toMatchObject({ quantity: "10.000001" })
  expect(commands[0].key).toMatch(/^[0-9a-f-]{36}$/)
  expect(commands[1]).toEqual(commands[0])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

for (const resource of ["payables", "receivables"] as const) {
  test(resource + ": vírgula é aceita e enviada como decimal canônico", async ({ page }) => {
    const body = { tenantId: tenant, canEdit: true, data: { id: record, receiptId: record, orderId: record, supplierName: "Fornecedor fixture", customerName: "Cliente fixture", dueDate: "2026-11-20", amount: "100.00", paidAmount: "0.00", receivedAmount: "0.00", outstandingAmount: "100.00", status: "open", revision: 1, paymentId: null }, payments: [] }
    let sent: { amount: string } | undefined
    await page.route("**/api/erp/" + (resource === "payables" ? "financial-payables" : resource) + "/" + record, route => route.fulfill({ headers: { ETag: '"1"' }, json: body }))
    await page.route("**/api/erp/" + (resource === "payables" ? "financial-payables" : resource) + "/" + record + "/payments", route => {
      sent = route.request().postDataJSON()
      return route.fulfill({ status: 422, json: { title: "Recusa controlada após captura do comando" } })
    })
    page.on("dialog", dialog => dialog.accept())
    await page.goto("/financeiro/contas-" + (resource === "payables" ? "pagar" : "receber") + "/" + record)
    const amount = page.getByLabel(resource === "payables" ? "Valor do pagamento" : /^Valor declarado/)
    await amount.fill("12,50")
    expect(await amount.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true)
    await page.getByLabel(resource === "payables" ? "Data do pagamento" : "Data do recebimento", { exact: true }).fill("2026-10-30")
    await page.getByLabel(resource === "payables" ? "Referência do pagamento" : "Referência do recebimento", { exact: true }).fill("Teste decimal")
    await page.getByRole("button", { name: resource === "payables" ? /Confirmar pagamento/ : "Confirmar recebimento declarado" }).click()
    await expect.poll(() => sent?.amount).toBe("12.50")
  })
}
