import { expect, test, type Page } from "@playwright/test"
import { installFrontendFixture, tenant } from "./helpers/frontend-fixture"

const supplier = "33333333-3333-4333-8333-333333333333"
const product = "44444444-4444-4444-8444-444444444444"
const purchase = "55555555-5555-4555-8555-555555555555"
const accessKey = "35261004252011000110550010000000011000000017"
const note = { id: 11, accessKey, issuerDocument: "04252011000110", issuerName: "Fornecedor da nota", recipientDocument: "19131243000197", number: 1, series: 1, issuedAt: "2026-10-27T12:00:00-03:00", totalCents: 1000, itemCount: 1, environment: 2, xmlSha256: "0".repeat(64), createdAt: "2026-10-31T12:00:00Z" }
const item = { number: 1, sourceCode: "XML-001", name: "Produto descrito no XML", unit: "UN", quantityMicros: 1_000_000, unitCostCents: 1000, merchandiseCents: 1000, landedCents: 1000, components: {} }
type Command = { key: string; revision: string; body: unknown }

test.beforeEach(async ({ context }) => installFrontendFixture(context))

async function details(page: Page, canConvert = true) {
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant, legalName: "Empresa da nota" }, permissions: ["fiscal.received_nfe.manage", ...(canConvert ? ["purchasing.orders.read", "purchasing.orders.manage"] : [])] } }))
  await page.route("**/api/erp/fiscal/received-nfes/11", route => route.fulfill({ json: { tenantId: tenant, data: note } }))
  await page.route("**/api/erp/fiscal/received-nfes/11/purchase", route => route.fulfill({ headers: { ETag: '"1"' }, json: { receivedNfeId: 11, revision: 1, purchaseOrderId: null, canConvert, items: [item], costs: [] } }))
  await page.route("**/api/erp/fiscal/manifestations**", route => route.fulfill({ json: { data: [] } }))
  await page.route("**/api/erp/parties?**", route => route.fulfill({ json: { data: [{ id: supplier, legalName: "Fornecedor da nota" }], total: 1 } }))
  await page.route("**/api/erp/products?**", route => route.fulfill({ json: { data: [{ id: product, name: "Produto do catálogo", sku: "CAT-001", unit: "UN" }], total: 1 } }))
}

test("consulta NSU repete o comando após resposta perdida e respeita o intervalo retornado", async ({ page }) => {
  const calls: Command[] = []
  let completed = false
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant, legalName: "Empresa da nota" }, permissions: ["fiscal.received_nfe.manage"] } }))
  await page.route("**/api/erp/fiscal/received-nfes?**", route => route.fulfill({ json: { tenantId: tenant, canImport: true, data: [], total: 0 } }))
  const status = () => ({ tenantId: tenant, revision: completed ? 3 : 1, lastNsu: "000000000000000", maxNsu: "000000000000000", nextQueryAt: completed ? new Date(Date.now() + 3_600_000).toISOString() : null, lastCode: completed ? "137" : null, running: false })
  await page.route("**/api/erp/fiscal/distribution/status", route => route.fulfill({ headers: { ETag: completed ? '"3"' : '"1"' }, json: status() }))
  await page.route("**/api/erp/fiscal/distribution/query", route => {
    calls.push({ key: route.request().headers()["idempotency-key"], revision: route.request().headers()["if-match"], body: route.request().postDataJSON() })
    if (calls.length === 1) return route.abort("failed")
    completed = true
    return route.fulfill({ headers: { ETag: '"3"' }, json: { ...status(), status: "completed", runId: purchase } })
  })
  await page.goto("/fiscal/monitor")
  await page.getByText("Distribuição em homologação — sem valor fiscal", { exact: true }).click()
  await page.getByRole("button", { name: "Consultar notas agora", exact: true }).click()
  await page.getByRole("button", { name: "Conferir consulta anterior", exact: true }).click()
  await expect(page.getByText("Consulta concluída. Os documentos recebidos estão armazenados nesta empresa.", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Consultar notas agora", exact: true })).toBeDisabled()
  expect(calls).toHaveLength(2)
  expect(calls[0]).toEqual(calls[1])
  expect(calls[0]).toMatchObject({ revision: '"1"', body: {} })
})

test("conversão vincula fornecedor e produto por nome e conserva o comando durante incerteza", async ({ page }) => {
  await details(page)
  const calls: Command[] = []
  let linked = false
  await page.route("**/api/erp/fiscal/received-nfes/11/purchase", route => {
    if (route.request().method() === "GET") return route.fulfill({ headers: { ETag: linked ? '"2"' : '"1"' }, json: { receivedNfeId: 11, revision: linked ? 2 : 1, purchaseOrderId: linked ? purchase : null, canConvert: true, items: [item], costs: [] } })
    calls.push({ key: route.request().headers()["idempotency-key"], revision: route.request().headers()["if-match"], body: route.request().postDataJSON() })
    if (calls.length === 1) return route.abort("failed")
    linked = true
    return route.fulfill({ status: 201, headers: { ETag: '"2"' }, json: { receivedNfeId: 11, revision: 2, purchaseOrderId: purchase } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/fiscal/monitor/11")
  await page.getByRole("button", { name: "Selecionar Fornecedor da nota", exact: true }).click()
  await page.getByRole("button", { name: "Selecionar Produto do catálogo · CAT-001", exact: true }).click()
  await page.getByLabel("Vencimento da compra importada", { exact: true }).fill("2026-11-30")
  await page.getByRole("button", { name: "Criar rascunho com custos da nota", exact: true }).click()
  await expect(page.getByLabel("Vencimento da compra importada", { exact: true })).toBeDisabled()
  await expect(page.getByLabel("Vencimento da compra importada", { exact: true })).toHaveValue("2026-11-30")
  await page.getByRole("button", { name: "Conferir criação da compra", exact: true }).click()
  await expect(page.getByRole("link", { name: "Abrir compra vinculada", exact: true })).toHaveAttribute("href", `/compras/pedidos/${purchase}`)
  expect(calls).toHaveLength(2)
  expect(calls[0]).toEqual(calls[1])
  expect(calls[0]).toMatchObject({ revision: '"1"', body: { supplierId: supplier, dueDate: "2026-11-30", items: [{ itemNumber: 1, productId: product }] } })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("nota de produção oferece compra operacional sem manifestação de homologação", async ({ page }) => {
  await details(page)
  await page.route("**/api/erp/fiscal/received-nfes/11", route => route.fulfill({ json: { tenantId: tenant, data: { ...note, environment: 1 } } }))
  const manifestations: string[] = []
  await page.route("**/api/erp/fiscal/manifestations**", route => {
    manifestations.push(route.request().url())
    return route.fulfill({ json: { data: [] } })
  })
  await page.goto("/fiscal/monitor/11")
  await expect(page.getByText("NF-e de produção: o rascunho será uma compra operacional da empresa.", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Selecionar Fornecedor da nota", exact: true }).click()
  await page.getByRole("button", { name: "Selecionar Produto do catálogo · CAT-001", exact: true }).click()
  await page.getByLabel("Vencimento da compra importada", { exact: true }).fill("2026-11-30")
  await expect(page.getByRole("button", { name: "Criar rascunho com custos da nota", exact: true })).toBeEnabled()
  await expect(page.getByRole("button", { name: "Registrar manifestação", exact: true })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Abrir monitor fiscal", exact: true })).toHaveAttribute("href", "/fiscal/monitor")
  expect(manifestations).toEqual([])
})

test("manifestação incerta consulta o histórico e bloqueia um segundo envio do mesmo evento", async ({ page }) => {
  await details(page, false)
  let calls = 0
  let submitted = false
  const manifestation = { id: purchase, accessKey, kind: "ciencia", revision: 2, status: "unknown", result: null }
  await page.route("**/api/erp/fiscal/manifestations**", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { data: submitted ? [manifestation] : [] } })
    calls += 1; submitted = true
    return route.fulfill({ headers: { ETag: '"2"' }, json: manifestation })
  })
  await page.goto("/fiscal/monitor/11")
  await page.getByRole("button", { name: "Registrar manifestação", exact: true }).click()
  await expect(page.getByText("Ciência da emissão: Resultado incerto: consulte antes de reenviar", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Registrar manifestação", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Consultar resultado da manifestação", exact: true }).click()
  expect(calls).toBe(1)
  await expect(page.getByRole("button", { name: "Criar rascunho com custos da nota", exact: true })).toHaveCount(0)
})
