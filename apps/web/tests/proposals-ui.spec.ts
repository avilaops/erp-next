import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

const product = "33333333-3333-4333-8333-333333333333"
const customer = "44444444-4444-4444-8444-444444444444"
const summary = { id: record, number: "1", version: 1, revision: 1, customerId: customer, customerName: "Cliente de teste", customerTaxId: "52998224725", validUntil: "2100-01-01", paymentTerms: "À vista", deliveryTerms: "Retirada pelo cliente", notes: "", amount: "49.98", status: "draft", expired: false, orderId: null, isCurrent: true, createdAt: "2026-11-03", sentAt: null, decidedAt: null, decidedBy: null, decisionReason: null }
const item = { productId: product, sku: "TEST", name: "Produto de teste", unit: "UN", quantity: "2.500000", unitPrice: "19.99", catalogPrice: "19.99", amount: "49.98", structureColor: null, upholsteryColor: null }
const detail = () => ({ tenantId: tenant, canEdit: true, data: { ...summary }, items: [{ ...item }], versions: [{ ...summary }] })

test.beforeEach(async ({ context, page }) => {
  await installFrontendFixture(context)
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant, legalName: "Empresa de teste" }, permissions: ["sales.proposals.read", "sales.proposals.manage"] } }))
})

test("central de vendas consulta dados reais e preserva pedidos quando propostas não são autorizadas", async ({ page }) => {
  await page.route(/\/api\/erp\/proposals\?limit=5$/, route => route.fulfill({ status: 403, json: { title: "Sem permissão para consultar propostas" } }))
  await page.route(/\/api\/erp\/orders\?limit=5$/, route => route.fulfill({ json: { tenantId: tenant, canEdit: false, total: 1, data: [{ id: record, customerName: "Cliente do pedido real", amount: "200.00", status: "draft" }] } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/vendas")
  await expect(page.getByRole("alert").filter({ hasText: "Sem permissão" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Cliente do pedido real" })).toBeVisible()
  await expect(page.getByText("1 pedido(s) cadastrado(s)")).toBeVisible()
  await expect(page.getByRole("link", { name: "Novo pedido", exact: true })).toHaveCount(0)
  await expect(page.getByRole("heading", { name: "Prévia de interface" })).toHaveCount(0)
  await expect(page.getByText("Vendas no mês", { exact: true })).toHaveCount(0)
  await page.route(/\/api\/erp\/proposals\?limit=5$/, route => route.fulfill({ json: { tenantId: tenant, canEdit: true, total: 0, data: [] } }))
  await page.getByRole("button", { name: "Tentar consultar propostas novamente" }).click()
  await expect(page.getByText("Nenhuma proposta cadastrada nesta empresa.")).toBeVisible()
  await expect(page.getByRole("link", { name: "Novo orçamento" })).toHaveAttribute("href", "/vendas/propostas/novo")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("criação exige condições explícitas e envia cliente e produtos reais com chave idempotente", async ({ page }) => {
  let saved: Record<string, unknown> | undefined
  await page.route(/\/api\/erp\/proposals(?:\?.*)?$/, route => {
    if (route.request().method() === "POST") {
      expect(route.request().headers()["x-tenant-id"]).toBe(tenant)
      expect(route.request().headers()["idempotency-key"]).toMatch(/^[a-f0-9-]{36}$/)
      saved = route.request().postDataJSON()
      return route.fulfill({ status: 201, headers: { ETag: '"1"' }, json: detail() })
    }
    return route.fulfill({ json: { tenantId: tenant, canEdit: true, data: [], total: 0, offset: 0, limit: 1 } })
  })
  await page.route(`**/api/erp/proposals/${record}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: detail() }))
  await page.route(/\/api\/erp\/parties\?/, route => route.fulfill({ json: { tenantId: tenant, total: 1, data: [{ id: customer, legalName: summary.customerName }] } }))
  await page.route(/\/api\/erp\/products\?/, route => route.fulfill({ json: { tenantId: tenant, total: 1, data: [{ id: product, name: item.name, sku: item.sku, basePrice: "19.99", unit: "UN", structureColors: [], upholsteryColors: [], hasPhoto: false }] } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/vendas/propostas/novo")
  for (const label of ["Validade da proposta", "Condições de pagamento", "Condições de entrega", "Observações"]) await expect(page.getByLabel(label, { exact: true })).toHaveValue("")
  await expect(page.getByRole("heading", { name: "Prévia de interface" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /^Selecionar / })).toHaveCount(0)
  await page.getByLabel("Buscar cliente", { exact: true }).fill("Cliente")
  await page.getByRole("button", { name: "Selecionar Cliente de teste" }).click()
  await expect(page.getByRole("region", { name: "Seleção de cliente", exact: true }).getByRole("status")).toHaveText("Cliente selecionado: Cliente de teste")
  await expect(page.getByRole("button", { name: "Selecionar Cliente de teste" })).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath("proposal-search-only-mobile.png"), fullPage: true })
  await page.getByLabel("Buscar produto", { exact: true }).fill("Produto")
  await page.getByRole("button", { name: /Selecionar Produto de teste/ }).click()
  await expect(page.getByRole("button", { name: /Selecionar Produto de teste/ })).toHaveCount(0)
  await page.getByLabel("Quantidade de Produto de teste", { exact: true }).fill("2,5")
  await expect(page.getByLabel("Preço unitário de Produto de teste", { exact: true })).toHaveAttribute("readonly", "")
  await expect(page.getByLabel("Preço unitário de Produto de teste", { exact: true })).toHaveValue("19,99")
  await page.getByLabel("Validade da proposta", { exact: true }).fill("2100-01-01")
  await page.getByLabel("Condições de pagamento", { exact: true }).fill("À vista")
  await page.getByLabel("Condições de entrega", { exact: true }).fill("Retirada pelo cliente")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.locator("form").last().evaluate(form => (form as HTMLFormElement).checkValidity())).toBe(true)
  await page.getByRole("button", { name: "Salvar proposta", exact: true }).click()
  await expect.poll(() => saved).toBeDefined()
  await expect(page).toHaveURL(new RegExp(`/vendas/propostas/${record}$`), { timeout: process.env.ERP_BROWSER_DEV === "1" ? 30_000 : 5_000 })
  expect(saved).toEqual({ customerId: customer, validUntil: "2100-01-01", paymentTerms: "À vista", deliveryTerms: "Retirada pelo cliente", notes: "", items: [{ productId: product, quantity: "2.500000", unitPrice: "19.99", structureColor: null, upholsteryColor: null }] })
  await page.reload()
  await expect(page.getByText("Total: R$ 49,98", { exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("proposal-mobile.png"), fullPage: true })
})

test("cadastra acabamentos em outra aba, atualiza opções e preserva preço brasileiro e rascunho", async ({ page, context }, info) => {
  let saved: unknown
  let catalog = { id: product, sku: "TEST", name: item.name, unit: "UN", ncm: null, cest: null, basePrice: "22468.09", status: "active", structureColors: [] as string[], upholsteryColors: [] as string[], revision: 1 }
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["sales.proposals.read", "sales.proposals.manage", "sales.proposals.negotiate"] } }))
  await page.route(`**/api/erp/proposals/${record}`, route => {
    if (route.request().method() === "PUT") saved = route.request().postDataJSON()
    return route.fulfill({ headers: { ETag: '\"1\"' }, json: { ...detail(), items: [{ ...item, unitPrice: "22468.09" }] } })
  })
  await context.route(`**/api/erp/products/${product}`, route => {
    if (route.request().method() === "PUT") catalog = { ...catalog, ...route.request().postDataJSON(), revision: 2 }
    return route.fulfill({ headers: { ETag: `"${catalog.revision}"` }, json: { tenantId: tenant, canEdit: true, data: catalog } })
  })
  await page.goto(`/vendas/propostas/${record}/editar`)
  const price = page.getByLabel(`Preço unitário de ${item.name}`, { exact: true })
  await expect(price).toHaveValue("22.468,09")
  await price.fill("10.000,00")
  await page.getByLabel("Condições de pagamento", { exact: true }).fill("Condição preservada")
  const link = page.getByRole("link", { name: `Cadastrar opções de Estrutura de ${item.name} (nova aba)`, exact: true })
  await expect(link).toHaveAttribute("target", "_blank")
  const opened = context.waitForEvent("page")
  await link.click()
  const editor = await opened
  await expect(editor).toHaveURL(new RegExp(`/cadastros/produtos/${product}/editar#product-colors$`))
  await editor.getByLabel("Cores da estrutura", { exact: true }).fill("Preto")
  await editor.getByLabel("Cores do estofado", { exact: true }).fill("Azul")
  await editor.getByRole("button", { name: "Salvar produto", exact: true }).click()
  await expect.poll(() => catalog.structureColors).toEqual(["Preto"])
  await editor.close()
  await page.getByRole("button", { name: `Atualizar opções de Estrutura de ${item.name}`, exact: true }).click()
  await page.getByRole("button", { name: `Atualizar opções de Estofado de ${item.name}`, exact: true }).click()
  await page.getByLabel(`Estrutura de ${item.name}`, { exact: true }).selectOption("Preto")
  await page.getByLabel(`Estofado de ${item.name}`, { exact: true }).selectOption("Azul")
  await expect(price).toHaveValue("10.000,00")
  await expect(page.getByLabel("Condições de pagamento", { exact: true })).toHaveValue("Condição preservada")
  expect(saved).toBeUndefined()
  await page.screenshot({ path: info.outputPath("proposal-options-and-brl.png"), fullPage: true })
  await page.getByRole("button", { name: "Salvar proposta", exact: true }).click()
  await expect.poll(() => saved).toMatchObject({ paymentTerms: "Condição preservada", items: [{ unitPrice: "10000.00", structureColor: "Preto", upholsteryColor: "Azul" }] })
})

test("conflito preserva a edição e bloqueia novos comandos até recarregar", async ({ page }) => {
  await page.route(`**/api/erp/proposals/${record}`, route => route.request().method() === "PUT"
    ? route.fulfill({ status: 412, json: { title: "Outra pessoa alterou a proposta" } })
    : route.fulfill({ headers: { ETag: '"1"' }, json: detail() }))
  await page.route(`**/api/erp/products/${product}`, route => route.fulfill({ json: { tenantId: tenant, data: { structureColors: [], upholsteryColors: [] } } }))
  await page.goto(`/vendas/propostas/${record}/editar`)
  await page.getByLabel("Condições de pagamento", { exact: true }).fill("30 dias após a entrega")
  await page.getByRole("button", { name: "Salvar proposta", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Outra pessoa alterou" })).toBeVisible()
  await expect(page.getByLabel("Condições de pagamento", { exact: true })).toHaveValue("30 dias após a entrega")
  await expect(page.getByRole("button", { name: "Salvar proposta", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Recarregar proposta", exact: true })).toBeVisible()
})

test("consulta não oferece decisões e impressão oculta os controles de operação", async ({ page }) => {
  const value = detail()
  value.canEdit = false
  value.data.status = "sent"
  await page.route(`**/api/erp/proposals/${record}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: value }))
  await page.goto(`/vendas/propostas/${record}`)
  await expect(page.getByText("Total: R$ 49,98", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Registrar aceite", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Cancelar proposta", exact: true })).toHaveCount(0)
  await page.emulateMedia({ media: "print" })
  await expect(page.getByRole("button", { name: "Imprimir / salvar PDF", exact: true })).toBeHidden()
  await expect(page.getByLabel("Histórico de versões", { exact: true })).toBeHidden()
  await expect(page.getByText("Total: R$ 49,98", { exact: true })).toBeVisible()
})

test("repetição após falha usa o mesmo comando e exige motivo para rejeição", async ({ page }) => {
  const value = detail()
  value.data.status = "sent"
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant, legalName: "Empresa de teste" }, permissions: ["sales.proposals.read", "sales.proposals.decide"] } }))
  await page.route(`**/api/erp/proposals/${record}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: value }))
  const commands: { key: string; body: unknown }[] = []
  await page.route(`**/api/erp/proposals/${record}/reject`, route => {
    commands.push({ key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() })
    return commands.length === 1 ? route.fulfill({ status: 503, json: { title: "Resultado indisponível" } }) : route.fulfill({ headers: { ETag: '"2"' }, json: value })
  })
  await page.goto(`/vendas/propostas/${record}`)
  await page.getByRole("button", { name: "Registrar rejeição", exact: true }).click()
  await expect(page.getByLabel("Motivo", { exact: true })).toHaveAttribute("required", "")
  await page.getByLabel("Motivo", { exact: true }).fill("Cliente adiou a compra")
  await page.getByRole("button", { name: "Confirmar operação", exact: true }).click()
  await page.getByRole("button", { name: "Repetir confirmação", exact: true }).click()
  await expect(page.getByText("Operação confirmada no servidor.", { exact: true })).toBeVisible()
  expect(commands).toHaveLength(2)
  expect(commands[1]).toEqual(commands[0])
  expect(commands[0].body).toEqual({ reason: "Cliente adiou a compra" })
})
