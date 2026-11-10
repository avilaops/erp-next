import { expect, test } from "@playwright/test"
import { createServer } from "node:http"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"
import { commercialMoney, commercialMoneyInput, commercialQuantity, normalizeCommercialMoney, orderNumber } from "../src/features/sales/order-presentation"

const order = { id: record, number: "17", customerName: "Cliente da pesquisa", customerTaxId: "52998224725", dueDate: "2026-12-30", amount: "199128.86", status: "draft" }

test.beforeEach(async ({ context }) => { await installFrontendFixture(context) })

test("apresentação comercial preserva precisão e remove somente zeros decimais desnecessários", () => {
  expect(orderNumber("1")).toBe("PV-000001")
  expect(orderNumber("1000000")).toBe("PV-1000000")
  expect(commercialMoney("2497.25")).toBe("R$ 2.497,25")
  expect(commercialMoney("10000.00")).toBe("R$ 10.000,00")
  expect(commercialMoneyInput("22468.09")).toBe("22.468,09")
  expect(normalizeCommercialMoney("R$ 10.000,00")).toBe("10000.00")
  expect(normalizeCommercialMoney("10.00,00")).toBeNull()
  expect(normalizeCommercialMoney("0,000001")).toBeNull()
  expect(commercialMoney("999999999999.99")).toBe("R$ 999.999.999.999,99")
  for (const [raw, display] of [["1.000000", "1"], ["2.500000", "2,5"], ["0.000001", "0,000001"], ["999999999999.999999", "999.999.999.999,999999"]]) expect(commercialQuantity(raw)).toBe(display)
})

test("detalhe mostra número comercial, quantidade e valores sem identificador técnico", async ({ page }, info) => {
  await page.route(`**/api/erp/orders/${record}`, route => route.fulfill({ headers: { ETag: '\"1\"' }, json: { tenantId: tenant, canEdit: false, data: { ...order, amount: "2497.25", revision: 1 }, items: [{ productId: record, name: "Produto da conferência", sku: "PROD-1", quantity: "1.000000", unit: "UN", unitPrice: "2497.25", amount: "2497.25" }] } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/vendas/pedidos/${record}`)
  await expect(page.getByRole("heading", { name: "PV-000017", exact: true })).toBeVisible()
  const items = page.getByRole("table", { name: "Itens do pedido", exact: true })
  await expect(items.getByRole("columnheader")).toHaveText("Produto e acabamento")
  await expect(items.getByText("1 UN", { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(items.getByText("R$ 2.497,25", { exact: true }).filter({ visible: true })).toHaveCount(2)
  const itemRegion = page.getByRole("region", { name: "Tabela de itens", exact: true })
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await itemRegion.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(items.getByRole("columnheader")).toHaveText(["Produto e acabamento", "Quantidade", "Unitário", "Total"])
  await page.setViewportSize({ width: 390, height: 844 })
  const negotiation = page.locator("details").filter({ has: page.locator("summary", { hasText: "Negociação e condições comerciais" }) })
  await expect(negotiation).not.toHaveAttribute("open", "")
  await negotiation.locator("summary").click()
  await expect(negotiation.getByRole("alert")).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.locator("main")).not.toContainText(record)
  await expect(page.locator("main")).not.toContainText("Revisão")
  await page.screenshot({ path: info.outputPath("order-commercial-mobile.png"), fullPage: true })
})

test("comissões ficam recolhidas e a falha de consulta continua acessível ao expandir", async ({ page }) => {
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["finance.commissions.read"] } }))
  await page.route(`**/api/erp/orders/${record}`, route => route.fulfill({ headers: { ETag: '\"1\"' }, json: { tenantId: tenant, canEdit: false, data: order, items: [] } }))
  await page.goto(`/vendas/pedidos/${record}`)
  const commissions = page.locator("details").filter({ has: page.locator("summary", { hasText: "Comissões do pedido" }) })
  await expect(commissions).not.toHaveAttribute("open", "")
  await commissions.locator("summary").click()
  await expect(commissions.getByRole("alert")).toBeVisible()
  await expect(page.getByRole("region", { name: "Itens do pedido", exact: true })).toBeVisible()
})

for (const role of ["sales", "finance", "director"]) test(`detalhe comercial preservado usa dados do pedido e restringe diretoria para ${role}`, async ({ page }, info) => {
  const permissions = ["sales.orders.read", "catalog.parties.read", ...(role === "director" ? ["platform.company.manage", "sales.approvals.director"] : role === "sales" ? ["platform.company.manage"] : ["finance.receivables.read"])]
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions } }))
  await page.route(`**/api/erp/orders/${record}`, route => route.fulfill({ headers: { ETag: '\"2\"' }, json: { tenantId: tenant, pricingOrigin: false, canEdit: false, data: { ...order, customerId: record, amount: "198.00", revision: 2, status: "completed" }, items: [{ productId: record, name: "Equipamento negociado", sku: "EQ-1", quantity: "2.000000", unit: "UN", unitPrice: "99.00", amount: "198.00" }] } }))
  await page.route(`**/api/erp/commercial/orders/${record}`, route => route.fulfill({ json: {
    tenantId: tenant, approvalStatus: "pending", canApprove: false, decisions: [],
    data: { version: 6, input: { destinationState: "SP", taxpayer: true }, sale: { items: [{ productId: record, quantity: 2, tableUnitCents: 10000, netCents: 18000, ipiCents: 1800, totalCents: 19800 }], tableTotalCents: 20000, discountCents: 2000, discountBps: 1000, netSaleCents: 18000, ipiCents: 1800, totalCents: 19800, freeDiscountBps: 500, downPaymentCents: 5000, freightCents: 1000, minimumDownPaymentBps: 2000, minimumDownPaymentCents: 3960, approvalReasons: ["desconto-acima-do-livre"] } },
    director: { equipmentCostCents: 7777, taxesCents: 1000, difalCents: 500, fixedFeeCents: 100, profitBeforeIncomeTaxCents: 9000, incomeTaxCents: 2000, netProfitCents: 7000, netProfitBps: 3500, targetBps: 2500, requiredDownPaymentCents: 9000, requiredDownPaymentBps: 4500, supplierPaymentCents: 6000 }
  } }))
  await page.route(`**/api/erp/parties/${record}`, route => route.fulfill({ json: { tenantId: tenant, data: { legalName: order.customerName, taxId: order.customerTaxId, tradeName: "Cliente comercial", email: "cliente@example.test", contacts: [{ name: "Contato do cliente", phone: "17999999999", primary: true }], addresses: [{ street: "Rua do cliente", number: "12", district: "Centro", city: "Rio Preto", state: "SP", postalCode: "15000000", primary: true }] } } }))
  await page.setViewportSize({ width: role === "director" ? 1280 : 390, height: 900 })
  await page.goto(`/vendas/pedidos/${record}`)
  const table = page.getByRole("table", { name: "Itens do pedido", exact: true })
  await expect(table.getByText("R$ 100,00", { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(table.getByText("R$ 20,00", { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(table.getByText("R$ 9,00", { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByText("Tabela v6", { exact: true })).toBeVisible()
  await expect(page.getByRole("region", { name: "Cliente do pedido" })).toContainText("Contato do cliente")
  await expect(page.getByRole("region", { name: "Entrega do pedido" })).toContainText("SP")
  await expect(page.getByRole("region", { name: "Pagamento do pedido" })).toContainText("R$ 148,00")
  await expect(page.getByRole("meter")).toHaveAttribute("aria-valuenow", "10")
  await expect(page.getByRole("region", { name: "Desconto e aprovação" })).toContainText("Aguardando aprovação")
  await expect(page.getByRole("button", { name: "Confirmar e reservar estoque", exact: true })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Editar rascunho", exact: true })).toHaveCount(0)
  await expect(page.getByRole("region", { name: "Análise da diretoria" })).toHaveCount(role === "director" ? 1 : 0)
  if (role !== "director") {
    await expect(page.locator("main")).not.toContainText("77,77")
    await page.getByText("Negociação e condições comerciais", { exact: true }).click()
    await expect(page.locator("main")).not.toContainText("77,77")
  } else await expect(page.getByRole("region", { name: "Análise da diretoria" })).toContainText("R$ 77,77")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`order-detail-${role}.png`), fullPage: true })
})

test("pedidos usam tabela e pesquisa no servidor, preservando filtro ao paginar", async ({ page }, info) => {
  const requests: URLSearchParams[] = []
  await page.route(/\/api\/erp\/orders\?/, route => {
    const query = new URL(route.request().url()).searchParams
    requests.push(query)
    return route.fulfill({ json: { tenantId: tenant, canEdit: true, total: query.get("q") === "ausente" ? 0 : 26, data: query.get("q") === "ausente" ? [] : [order] } })
  })
  await page.goto("/vendas/pedidos")
  await expect(page.getByText("Indicadores de vendas", { exact: true })).toHaveCount(0)
  await expect(page.getByText("Rascunho, reserva e conclusão comercial com geração de conta a receber. Não emite documento fiscal.")).toHaveCount(0)
  await expect(page.getByRole("navigation", { name: "Caminho de navegação" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Novo pedido", exact: true })).toHaveAttribute("href", "/vendas/pedidos/novo")
  const table = page.getByRole("table", { name: "Pedidos de venda" })
  await expect(table.getByRole("columnheader")).toHaveText(["Pedido", "Cliente", "Situação", "Vencimento", "Valor"])
  await expect(table.getByRole("link", { name: "PV-000017", exact: true })).toHaveAttribute("href", `/vendas/pedidos/${record}`)
  await expect(table.getByRole("link", { name: order.customerName, exact: true })).toHaveAttribute("href", `/vendas/pedidos/${record}`)
  await expect(table).not.toContainText("Pedido de ")
  await expect(table).toContainText("199.128,86")
  await expect(table).toContainText("30/12/2026")
  await page.getByLabel("Buscar pedidos", { exact: true }).fill("  Cliente  ")
  await expect.poll(() => requests.at(-1)?.get("q")).toBe("Cliente")
  await page.getByRole("button", { name: "Próxima", exact: true }).click()
  await expect.poll(() => requests.at(-1)?.get("offset")).toBe("25")
  expect(requests.at(-1)?.get("q")).toBe("Cliente")
  await page.getByLabel("Buscar pedidos", { exact: true }).fill("ausente")
  await page.getByRole("button", { name: "Pesquisar", exact: true }).click()
  await expect(page.getByText("Nenhum pedido encontrado para esta pesquisa.")).toBeVisible()
  expect(requests.at(-1)?.get("offset")).toBe("0")
  await page.getByRole("button", { name: "Limpar", exact: true }).click()
  await expect(table).toBeVisible()
  expect(requests.at(-1)?.get("q")).toBeNull()
  await page.emulateMedia({ colorScheme: "dark" })
  await page.screenshot({ path: info.outputPath("orders-desktop.png"), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath("orders-mobile.png"), fullPage: true })
})

test("novo pedido mantém cliente e produto em buscas compactas até pesquisar", async ({ page }) => {
  await page.route(/\/api\/erp\/orders\?/, route => route.fulfill({ json: { tenantId: tenant, canEdit: true, total: 0, data: [] } }))
  await page.route(/\/api\/erp\/parties\?/, route => route.fulfill({ json: { tenantId: tenant, total: 1, data: [{ id: record, legalName: "Cliente disponível" }] } }))
  await page.route(/\/api\/erp\/products\?/, route => route.fulfill({ json: { tenantId: tenant, total: 1, data: [{ id: record, name: "Produto disponível", sku: "PROD-1", unit: "UN", basePrice: "10.00" }] } }))
  await page.goto("/vendas/pedidos/novo")
  await expect(page.getByRole("heading", { name: "Novo pedido", exact: true })).toBeVisible()
  await expect(page.getByRole("navigation", { name: "Caminho de navegação" })).toContainText("Novo")
  await expect(page.getByRole("button", { name: "Selecionar Cliente disponível", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Selecionar Produto disponível · PROD-1", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Pesquisar cliente", exact: true }).click()
  await expect(page.getByLabel("Buscar cliente", { exact: true })).toBeFocused()
  await page.getByRole("button", { name: "Selecionar Cliente disponível", exact: true }).click()
  await expect(page.getByText("Cliente selecionado: Cliente disponível", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Selecionar Cliente disponível", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Pesquisar produto", exact: true }).click()
  await expect(page.getByLabel("Buscar produto", { exact: true })).toBeFocused()
  await expect(page.getByRole("button", { name: "Selecionar Produto disponível · PROD-1", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Pesquisar produto", exact: true }).press("Escape")
  await expect(page.getByRole("button", { name: "Selecionar Produto disponível · PROD-1", exact: true })).toHaveCount(0)
})

test("falha de pesquisa mantém os filtros e permite repetir em modo de consulta", async ({ page }) => {
  let failing = false
  await page.route(/\/api\/erp\/orders\?/, route => route.fulfill(failing ? { status: 503, json: { title: "Consulta temporariamente indisponível" } } : { json: { tenantId: tenant, canEdit: false, total: 1, data: [order] } }))
  await page.goto("/vendas/pedidos")
  await expect(page.getByRole("table")).toBeVisible()
  await expect(page.getByRole("link", { name: "Novo pedido", exact: true })).toHaveCount(0)
  failing = true
  await page.getByLabel("Buscar pedidos", { exact: true }).fill("Cliente")
  await page.getByRole("button", { name: "Pesquisar", exact: true }).click()
  await expect(page.locator("main").getByRole("alert")).toContainText("Consulta temporariamente indisponível")
  await expect(page.getByLabel("Buscar pedidos", { exact: true })).toHaveValue("Cliente")
  failing = false
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click()
  await expect(page.getByRole("table")).toBeVisible()
})

test("pesquisa do catálogo agrupa digitação rápida e mantém foco após atualizar a URL", async ({ page }) => {
  const searches: string[] = []
  await page.route(/\/api\/erp\/products\?/, route => {
    const q = new URL(route.request().url()).searchParams.get("q") || ""
    searches.push(q)
    return route.fulfill({ json: { tenantId: tenant, canEdit: false, total: 1, data: [{ id: record, name: "Produto localizado", sku: "TEST", unit: "UN", basePrice: "10.00", status: "active", hasPhoto: false }] } })
  })
  await page.goto("/cadastros/produtos")
  const search = page.getByLabel("Buscar nome ou SKU", { exact: true })
  await expect(page.getByRole("link", { name: "Produto localizado", exact: true })).toBeVisible()
  await search.fill("antigo")
  await search.fill("novo")
  await expect.poll(() => searches.at(-1)).toBe("novo")
  expect(searches).not.toContain("antigo")
  await expect(search).toBeFocused()
  await search.pressSequentially(" produto")
  await expect.poll(() => searches.at(-1)).toBe("novo produto")
  await expect(search).toHaveValue("novo produto")
  await expect(search).toBeFocused()
  await page.goBack()
  await expect(search).toHaveValue("novo")
})

test("BFF encaminha pesquisa e paginação e rejeita filtros desconhecidos ou duplicados", async ({ context }) => {
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(request.url || "")
    response.writeHead(200, { "Content-Type": "application/json" })
    response.end(JSON.stringify({ tenantId: tenant, canEdit: false, data: [], total: 0 }))
  })
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(33119, "127.0.0.1", resolve) })
  try {
    const response = await context.request.get("/api/erp/orders?q=Cliente%20%26%20Filhos&offset=25&limit=25")
    expect(response.status()).toBe(200)
    expect(requests).toEqual(["/api/v1/orders?q=Cliente+%26+Filhos&offset=25&limit=25"])
    for (const query of ["q=a&q=b", "unknown=1"]) expect((await context.request.get(`/api/erp/orders?${query}`)).status()).toBe(400)
    expect(requests).toHaveLength(1)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
