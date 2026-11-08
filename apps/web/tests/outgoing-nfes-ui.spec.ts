import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant } from "./helpers/frontend-fixture"
const id = "22222222-2222-4222-8222-222222222222"
const pending = "33333333-3333-4333-8333-333333333333"
test.beforeEach(async ({ context, page }) => {
 await installFrontendFixture(context)
 await page.route("**/api/erp/me", r => r.fulfill({ json: { tenant: { id: tenant }, permissions: ["fiscal.nfe.read", "fiscal.nfe.manage", "fiscal.nfe.cancel", "fiscal.nfe.correction"] } }))
 await page.route("**/api/erp/fiscal/certificate", r => r.fulfill({ json: { tenantId: tenant, status: "active" } }))
 await page.route("**/api/erp/fiscal/readiness", r => r.fulfill({ json: { tenantId: tenant, environment: "production", profileConfigured: true, certificateVerified: true, canTransmit: true, productionEnabled: true, blockers: [] } }))
 await page.route("**/api/erp/fiscal/nfe?*", r => r.fulfill({ json: { tenantId: tenant, nextCursor: null, data: [
  { id, createdAt: "2026-11-08T12:00:00Z", productsTotal: "100.00", input: { model: 55, environment: "production", recipient: { legalName: "Cliente autorizado", taxId: "11222333000181" } } },
  { id: pending, createdAt: "2026-11-07T12:00:00Z", productsTotal: "50.00", input: { model: 55, environment: "homologation", recipient: { legalName: "Cliente rascunho", taxId: "52998224725" } } }
 ] } }))
 await page.route("**/api/erp/fiscal/issued-nfes?*", r => r.fulfill({ json: { tenantId: tenant, nextCursor: null, data: [{ id, model: 55, status: "authorized", environment: "production", series: 1, number: 42, issuedAt: "2026-11-08T12:00:00Z" }] } }))
})
test("lista reúne notas sem duplicação, filtra e mantém ações nos detalhes", async ({ page }) => {
 const mutations: string[] = []
 page.on("request", r => { if (r.url().includes("/api/erp/") && r.method() !== "GET") mutations.push(r.url()) })
 await page.goto("/fiscal/notas-saida")
 await expect(page.getByText("2 nota(s)", { exact: true })).toBeVisible()
 await expect(page.getByText("Cliente autorizado", { exact: true })).toHaveCount(1)
 await expect(page.getByRole("link", { name: "Ver nota e documentos" })).toHaveAttribute("href", `/fiscal/notas-saida/${id}#fiscal-emission`)
 await page.getByLabel("Situação", { exact: true }).selectOption("draft")
 await expect(page.getByText("Cliente autorizado", { exact: true })).toHaveCount(0)
 await expect(page.getByRole("link", { name: "Editar rascunho" })).toBeVisible()
 await page.getByRole("button", { name: "Limpar filtros" }).click()
 await page.getByLabel("Buscar nota", { exact: true }).fill("11.222.333/0001-81")
 await expect(page.getByText("1 nota(s)", { exact: true })).toBeVisible()
 await page.getByRole("button", { name: "Limpar filtros" }).click()
 await page.getByLabel("De", { exact: true }).fill("2026-11-08")
 await expect(page.getByText("Cliente rascunho", { exact: true })).toHaveCount(0)
 for (const width of [390, 1280]) {
  await page.setViewportSize({ width, height: 900 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
 }
 expect(mutations).toEqual([])
})
test("lista preserva o ambiente sem painel de preparação e atualizar consulta a configuração novamente", async ({ page }) => {
 let connected = false
 let readinessCalls = 0
 await page.route("**/api/erp/fiscal/readiness", r => {
  readinessCalls++
  return r.fulfill({ json: { tenantId: tenant, environment: connected ? "production" : "homologation", profileConfigured: true, certificateVerified: connected, canTransmit: connected, blockers: connected ? [] : ["a1_certificate_missing_expired_or_unavailable"] } })
 })
 await page.goto("/fiscal/notas-saida")
 await expect(page.getByText("Ambiente: Homologação · sem valor fiscal", { exact: true })).toBeVisible()
 await expect(page.getByText("2 nota(s)", { exact: true })).toBeVisible()
 await expect(page.getByText(/Preparação para emissão ·/)).toHaveCount(0)
 const before = readinessCalls
 connected = true
 await page.getByRole("button", { name: "Atualizar lista" }).click()
 await expect.poll(() => readinessCalls).toBeGreaterThan(before)
 await expect(page.getByText("Ambiente: Produção", { exact: true })).toBeVisible()
 await expect(page.getByRole("link", { name: "Preparar nota", exact: true })).toHaveAttribute("href", "/fiscal/notas-saida/nova")
 await expect(page.getByText(/Preparação para emissão ·/)).toHaveCount(0)
})

test("recusa lista de outra empresa", async ({ page }) => {
 await page.route("**/api/erp/fiscal/issued-nfes?*", r => r.fulfill({ json: { tenantId: id, data: [], nextCursor: null } }))
 await page.goto("/fiscal/notas-saida")
 await expect(page.getByRole("alert").filter({ hasText: "A empresa da sessão mudou" })).toContainText("A empresa da sessão mudou")
 await expect(page.getByText("Cliente autorizado", { exact: true })).toHaveCount(0)
})


test("editor em etapas preserva campos e retorna à pendência ao salvar", async ({ page }) => {
 await page.route("**/api/erp/fiscal/settings/operation-natures", r => r.fulfill({ json: { tenantId: tenant, revision: 1, data: { items: [] } } }))
 await page.route("**/api/erp/registration-settings/tax-profiles", r => r.fulfill({ json: { tenantId: tenant, revision: 1, data: { profiles: [] } } }))
 await page.goto("/fiscal/notas-saida/nova")
 await expect(page.getByText("Etapa 1 de 6 · Dados da nota", { exact: true })).toBeVisible()
 await page.getByRole("button", { name: "2. Destinatário", exact: true }).click()
 await page.getByLabel("Nome ou razão social", { exact: true }).fill("Cliente preservado")
 await page.screenshot({ path: test.info().outputPath("editor-operacao.png"), fullPage: true })
 await page.getByRole("button", { name: "3. Produtos", exact: true }).click()
 await expect(page.getByRole("heading", { name: "Itens", exact: true })).toBeVisible()
 await expect(page.getByRole("heading", { name: "Destinatário", exact: true })).not.toBeVisible()
 await page.getByRole("button", { name: "2. Destinatário", exact: true }).click()
 await expect(page.getByLabel("Nome ou razão social", { exact: true })).toHaveValue("Cliente preservado")
 await page.getByRole("button", { name: "6. Revisão e emissão", exact: true }).click()
 await expect(page.getByRole("heading", { name: "Confira a nota antes de salvar ou emitir" })).toBeVisible()
 await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click()
 await expect(page.getByText("Etapa 1 de 6 · Dados da nota", { exact: true })).toBeVisible()
 await expect(page.getByText("Confira o campo indicado antes de salvar o rascunho.", { exact: true })).toBeVisible()
 for (const width of [390, 1280]) {
  await page.setViewportSize({ width, height: 900 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
 }
})

test("destinatário reaproveita o cadastro e deixa o IBGE explícito para conferência", async ({ page }) => {
 await page.route("**/api/erp/me", r => r.fulfill({ json: { tenant: { id: tenant }, permissions: ["fiscal.nfe.read", "fiscal.nfe.manage", "catalog.parties.read"] } }))
 await page.route("**/api/erp/parties?*", r => r.fulfill({ json: { tenantId: tenant, data: [{ id, taxId: "11222333000181", legalName: "Cliente do cadastro" }] } }))
 await page.route(`**/api/erp/parties/${id}`, r => r.fulfill({ json: { tenantId: tenant, data: { id, taxId: "11222333000181", legalName: "Cliente do cadastro", addresses: [{ primary: true, state: "SP", postalCode: "01001-000", street: "Praça da Sé", number: "1", district: "Sé" }] } } }))
 await page.route("**/api/erp/fiscal/settings/operation-natures", r => r.fulfill({ json: { tenantId: tenant, revision: 1, data: { items: [] } } }))
 await page.route("**/api/erp/registration-settings/tax-profiles", r => r.fulfill({ json: { tenantId: tenant, revision: 1, data: { profiles: [] } } }))
 await page.goto("/fiscal/notas-saida/nova")
 await page.getByRole("button", { name: "2. Destinatário", exact: true }).click()
 await page.getByLabel("Buscar cliente cadastrado", { exact: true }).fill("Cliente")
 await page.getByRole("button", { name: "Buscar cliente", exact: true }).click()
 await page.getByRole("button", { name: "Usar Cliente do cadastro · 11222333000181", exact: true }).click()
 await expect(page.getByLabel("Nome ou razão social", { exact: true })).toHaveValue("Cliente do cadastro")
 await expect(page.getByLabel("CEP", { exact: true })).toHaveValue("01001000")
 await expect(page.getByLabel("Código IBGE do município", { exact: true })).toHaveValue("")
})

test("salvar abre a etapa e o grupo tributário com o campo obrigatório pendente", async ({ page }) => {
 const input = {
  model: 55, environment: "production", operationNature: "Venda", taxRuleReference: "Perfil revisado", purpose: 1,
  recipient: { legalName: "Cliente", taxId: "11222333000181", state: "SP", municipalityCode: "3550308", postalCode: "01001000", street: "Praça da Sé", number: "1", district: "Sé" },
  items: [{ code: "P1", description: "Produto", unit: "UN", ncm: "95069100", cfop: "5102", quantity: "1.0000", unitPrice: "100.00", grossTotal: "100.00", origin: 0, icmsCst: "00", pisCst: "01", cofinsCst: "01" }],
  productsTotal: "100.00", payments: [{ code: "17", amount: "100.00" }],
  taxDeclaration: { recipientTaxpayer: false, finalConsumer: true, ipiInIcmsBase: false, icmsOutOfContributions: false, icmsRate: "18", pisRate: "1.65", cofinsRate: "7.6", ibsCbs: { cst: "", classCode: "", ibsStateRate: "", ibsCityRate: "", cbsRate: "" } }
 }
 await page.route(`**/api/erp/fiscal/nfe/${id}`, r => r.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: { id, revision: 1, input, issuer: { legalName: "Emitente de teste" } } } }))
 await page.route(`**/api/erp/fiscal/nfe/${id}/emission`, r => r.fulfill({ status: 404, json: { title: "Ainda sem emissão" } }))
 await page.route(`**/api/erp/fiscal/nfe/${id}/events`, r => r.fulfill({ json: { tenantId: tenant, data: [] } }))
 await page.route("**/api/erp/registration-settings/tax-profiles", r => r.fulfill({ json: { tenantId: tenant, revision: 1, data: { profiles: [] } } }))
 await page.route("**/api/erp/fiscal/settings/operation-natures", r => r.fulfill({ json: { tenantId: tenant, revision: 1, data: { items: [] } } }))
 await page.goto(`/fiscal/notas-saida/${id}`)
 await page.getByRole("button", { name: "2. Destinatário", exact: true }).click()
 await page.getByLabel("Nome ou razão social", { exact: true }).fill("Cliente revisado")
 await page.getByRole("button", { name: "6. Revisão e emissão", exact: true }).click()
 await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click()
 await expect(page.getByText("Etapa 4 de 6 · Tributação", { exact: true })).toBeVisible()
 await expect(page.getByLabel("CST do IBS/CBS", { exact: true })).toBeVisible()
 await expect(page.getByLabel("CST do IBS/CBS", { exact: true })).toBeFocused()
})

for (const collapsed of [false, true]) {
 test(`preferências ocultam o menu principal e preservam o estado anterior: ${collapsed}`, async ({ page }) => {
  await page.goto("/cadastros/produtos")
  const sidebar = page.locator(".erp-sidebar")
  await expect(sidebar).toBeVisible()
  if (collapsed) await sidebar.getByRole("button", { name: "Recolher navegação", exact: true }).first().click()
  await sidebar.getByRole("button", { name: "Preferências", exact: true }).click()
  await sidebar.getByRole("link", { name: "Visão geral das preferências", exact: true }).click()
  await expect(sidebar).not.toBeVisible()
  await expect(page.locator(".erp-workspace-body")).toHaveCSS("margin-left", "0px")
  await page.getByRole("button", { name: "Abrir menu", exact: true }).click()
  const drawer = page.getByRole("dialog")
  await drawer.getByRole("button", { name: "Cadastros", exact: true }).click()
  await drawer.getByRole("link", { name: "Produtos", exact: true }).click()
  await expect(sidebar).toBeVisible()
  await expect(page.locator(".erp-workspace")).toHaveAttribute("data-collapsed", String(collapsed))
  await page.goto("/preferencias/empresa/dados")
  await expect(sidebar).not.toBeVisible()
  await expect(page.getByRole("button", { name: "Abrir menu", exact: true })).toBeVisible()
 })
}
