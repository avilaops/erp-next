import { expect, test } from "@playwright/test"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { once } from "node:events"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"
import { origin } from "../playwright.danfe.config"

const draft = { environment: "homologation", model: 55, operationNature: "Venda", taxRuleReference: "Instrução de teste", recipient: { taxId: "11222333000181", legalName: "Cliente de teste", state: "SP", municipalityCode: "3549805", postalCode: "15035000", street: "Rua Teste", number: "1", district: "Centro" }, items: [{ code: "P1", description: "Produto", unit: "UN", ncm: "95069100", cfop: "5102", quantity: "1.0000", unitPrice: "100.0000000000", grossTotal: "100.00", origin: 0, csosn: "102", icmsCst: null, pisCst: "07", cofinsCst: "07" }], productsTotal: "100.00", payments: [{ code: "17", amount: "100.00", description: null }] }
const nfceKey = `${"35261012345678000195550010000001231482917364".slice(0, 20)}65${"35261012345678000195550010000001231482917364".slice(22)}`
const nfceXml = "<nfeProc xmlns=\"http://www.portalfiscal.inf.br/nfe\"><NFe><infNFe><ide><mod>65</mod></ide></infNFe></NFe></nfeProc>"
const nfcePdf = Buffer.from("%PDF-1.7 NFC-e synthetic")
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex")

test.beforeEach(async ({ context }) => installFrontendFixture(context))

test("NFC-e usa o fluxo fiscal persistente de modelo 65", async ({ page }) => {
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["fiscal.nfe.read", "fiscal.nfe.manage"] } }))
  await page.route("**/api/erp/fiscal/nfe?*", route => route.fulfill({ json: { tenantId: tenant, data: [], nextCursor: null } }))
  await page.route("**/api/erp/fiscal/readiness", route => route.fulfill({ json: { tenantId: tenant, profileConfigured: true, certificateVerified: true, canTransmit: false, productionEnabled: false, blockers: [] } }))
  await page.goto("/fiscal/nfce")
  await expect(page.getByRole("heading", { name: "Rascunhos de NFC-e", exact: true })).toBeVisible()
  await expect(page.getByText("Nenhum rascunho cadastrado nesta empresa.", { exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Preparar NFC-e", exact: true })).toHaveAttribute("href", "/fiscal/notas-saida/nova?modelo=65")
})

test("NFC-e autorizada gera DANFE e valida XML e PDF pelo BFF", async ({ page }) => {
  const danfeRequests: string[] = []
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["fiscal.nfe.read", "fiscal.nfe.issue"] } }))
  await page.route("**/api/erp/fiscal/readiness", route => route.fulfill({ json: { tenantId: tenant, profileConfigured: true, certificateVerified: true, canTransmit: true, productionEnabled: false, blockers: [] } }))
  await page.route(`**/api/erp/fiscal/nfe/${record}`, route => route.fulfill({ headers: { ETag: '"3"' }, json: { tenantId: tenant, canEdit: false, data: { id: record, revision: 3, status: "draft", input: { ...draft, model: 65 }, issuer: { legalName: "Empresa teste" } } } }))
  await page.route(`**/api/erp/fiscal/nfe/${record}/emission`, route => route.fulfill({ headers: { ETag: '"4"' }, json: { tenantId: tenant, id: record, status: "authorized", environment: "homologation", model: 65, revision: 4, number: 1, series: 1, accessKey: nfceKey, protocol: "135260000000001", result: {} } }))
  await page.route(`**/api/erp/fiscal/nfe/${record}/xml`, route => route.fulfill({ headers: { "Content-Type": "application/xml; charset=utf-8" }, body: nfceXml }))
  await page.route("**/api/erp/fiscal/danfe", async route => {
    const body = route.request().postDataJSON() as { xml: string }
    danfeRequests.push(body.xml)
    return route.fulfill({
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="DANFE-${nfceKey}.pdf"`,
        "X-XML-SHA256": digest(nfceXml),
        "X-PDF-SHA256": digest(nfcePdf),
      },
      body: nfcePdf,
    })
  })
  await page.goto(`/fiscal/nfce/${record}`)
  await expect(page.getByText("Situação fiscal: Autorizada em homologação", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Gerar DANFE NFC-e", exact: true }).click()
  await expect(page.getByTitle("Visualização do NFC-e", { exact: true })).toHaveAttribute("src", /^blob:/)
  await expect(page.getByText(digest(nfceXml), { exact: true })).toBeVisible()
  await expect(page.getByText(digest(nfcePdf), { exact: true })).toBeVisible()
  expect(danfeRequests).toEqual([nfceXml])
})

test("lista de NF-e distingue emissão em homologação da produção indisponível", async ({ page }) => {
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["fiscal.nfe.read", "fiscal.nfe.manage"] } }))
  await page.route("**/api/erp/fiscal/nfe?*", route => route.fulfill({ json: { tenantId: tenant, data: [], nextCursor: null } }))
  await page.route("**/api/erp/fiscal/readiness", route => route.fulfill({ json: { tenantId: tenant, profileConfigured: true, certificateVerified: true, canTransmit: true, productionEnabled: false, blockers: [] } }))
  await page.goto("/fiscal/notas-saida")
  await expect(page.getByText("A emissão usa o ambiente escolhido na configuração fiscal. Homologação é um ambiente de testes, sem valor fiscal.", { exact: false })).toBeVisible()
  await expect(page.getByText("A transmissão à SEFAZ permanece indisponível.", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Preparar nota", exact: true })).toBeVisible()
})

test("emissão conserva comando em resposta incerta e eventos usam a revisão fiscal", async ({ page }) => {
  const calls: { key: string; revision: string; body: unknown }[] = []
  let issued = false, cancelled = false
  page.on("dialog", dialog => dialog.accept())
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["fiscal.nfe.read", "fiscal.nfe.manage", "fiscal.nfe.issue", "fiscal.nfe.cancel", "fiscal.nfe.correction"] } }))
  await page.route("**/api/erp/fiscal/readiness", route => route.fulfill({ json: { tenantId: tenant, profileConfigured: true, certificateVerified: true, canTransmit: true, productionEnabled: false, blockers: [] } }))
  await page.route(`**/api/erp/fiscal/nfe/${record}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: { id: record, revision: 1, status: "draft", input: draft, issuer: { legalName: "Empresa teste" } } } }))
  await page.route(`**/api/erp/fiscal/nfe/${record}/emission`, route => issued ? route.fulfill({ headers: { ETag: cancelled ? '"4"' : '"3"' }, json: { tenantId: tenant, id: record, status: cancelled ? "cancelled" : "authorized", revision: cancelled ? 4 : 3, number: 1, series: 1, accessKey: "35261012345678000195550010000001231482917364", protocol: "135260000000001", result: {} } }) : route.fulfill({ status: 404, json: { title: "Sem emissão" } }))
  await page.route(`**/api/erp/fiscal/nfe/${record}/issue`, route => {
    calls.push({ key: route.request().headers()["idempotency-key"], revision: route.request().headers()["if-match"], body: route.request().postDataJSON() })
    issued = true
    return calls.length === 1 ? route.abort("failed") : route.fulfill({ headers: { ETag: '"3"' }, json: { tenantId: tenant, id: record, status: "authorized", revision: 3 } })
  })
  await page.route(`**/api/erp/fiscal/nfe/${record}/cancel`, route => {
    expect(route.request().headers()["if-match"]).toBe('"3"')
    expect(route.request().postDataJSON()).toEqual({ text: "Cancelamento solicitado pelo cliente" })
    cancelled = true
    return route.fulfill({ headers: { ETag: '"4"' }, json: { tenantId: tenant, status: "registered", revision: 4 } })
  })
  await page.goto(`/fiscal/notas-saida/${record}`)
  await expect(page.getByRole("combobox", { name: "Forma de pagamento 1", exact: true })).toHaveValue("17")
  await page.getByRole("button", { name: "Emitir NF-e em homologação", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "Forma de pagamento 1", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Conferir mesma operação fiscal", exact: true }).click()
  expect(calls).toHaveLength(2); expect(calls[0]).toEqual(calls[1])
  await expect(page.getByText("Situação fiscal: Autorizada em homologação", { exact: true })).toBeVisible()
  await page.getByRole("combobox", { name: "Evento fiscal", exact: true }).selectOption("cancel")
  await page.getByLabel("Texto do evento", { exact: true }).fill("Cancelamento solicitado pelo cliente")
  await page.getByRole("button", { name: "Transmitir evento fiscal", exact: true }).click()
  await expect(page.getByText("Situação fiscal: Cancelada na SEFAZ", { exact: true })).toBeVisible()
})

for (const scenario of [
  { name: "emissor", grants: ["fiscal.nfe.issue"], cancel: false, correction: false },
  { name: "cancelador", grants: ["fiscal.nfe.cancel"], cancel: true, correction: false },
  { name: "corretor", grants: ["fiscal.nfe.correction"], cancel: false, correction: true },
  { name: "leitor", grants: [], cancel: false, correction: false },
]) {
  test(`eventos fiscais respeitam permissão exclusiva de ${scenario.name} em cinco tamanhos`, async ({ page }) => {
    const commands: string[] = []
    await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["fiscal.nfe.read", ...scenario.grants] } }))
    await page.route("**/api/erp/fiscal/readiness", route => route.fulfill({ json: { tenantId: tenant, profileConfigured: true, certificateVerified: true, canTransmit: false, productionEnabled: false, blockers: [] } }))
    await page.route(`**/api/erp/fiscal/nfe/${record}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: false, data: { id: record, revision: 1, status: "draft", input: draft, issuer: { legalName: "Empresa teste" } } } }))
    await page.route(`**/api/erp/fiscal/nfe/${record}/*`, route => {
      if (route.request().method() !== "GET") {
        commands.push(route.request().url())
        expect(route.request().headers()["if-match"]).toBe('"3"')
        expect(route.request().postDataJSON()).toEqual({ text: "Evento sintético da permissão exclusiva" })
      }
      return route.fulfill({ headers: { ETag: '"3"' }, json: { tenantId: tenant, id: record, status: "authorized", revision: 3, number: 1, series: 1, accessKey: "35261012345678000195550010000001231482917364", protocol: "135260000000001", result: {} } })
    })
    await page.route(`**/api/erp/fiscal/nfe/${record}/events`, route => route.fulfill({ json: { tenantId: tenant, data: [] } }))
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`/fiscal/notas-saida/${record}`)
      await expect(page.getByText("Situação fiscal: Autorizada em homologação", { exact: true })).toBeVisible()
      const control = page.getByRole("combobox", { name: "Evento fiscal", exact: true })
      if (scenario.cancel || scenario.correction) {
        await expect(control).toBeVisible()
        await expect(control.locator('option[value="cancel"]')).toHaveCount(scenario.cancel ? 1 : 0)
        await expect(control.locator('option[value="correction"]')).toHaveCount(scenario.correction ? 1 : 0)
        await expect(control).toHaveValue(scenario.correction ? "correction" : "cancel")
        const bounds = await control.boundingBox()
        expect(bounds?.height).toBeGreaterThanOrEqual(44)
      } else {
        await expect(control).toHaveCount(0)
      }
      await expect(page.getByRole("button", { name: "Baixar XML da emissão", exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `Largura do documento em ${width}px`).toBeLessThanOrEqual(width)
    }
    expect(commands).toEqual([])
    if (scenario.cancel || scenario.correction) {
      page.on("dialog", dialog => dialog.accept())
      await page.getByLabel("Texto do evento", { exact: true }).fill("Evento sintético da permissão exclusiva")
      await page.getByRole("button", { name: "Transmitir evento fiscal", exact: true }).click()
      await expect(page.getByText("Resultado registrado. Confira a situação fiscal atualizada abaixo.", { exact: true })).toBeVisible()
      expect(commands).toEqual([`${origin}/api/erp/fiscal/nfe/${record}/${scenario.cancel ? "cancel" : "correction"}`])
    }
  })
}

test("BFF encaminha empresa revisão e idempotência e recusa origem ou sessão divergente", async ({ context }) => {
  const seen: { path: string; key?: string; revision?: string; tenant?: string }[] = []
  const backend = createServer((request, response) => {
    seen.push({ path: request.url || "", key: String(request.headers["idempotency-key"] || ""), revision: String(request.headers["if-match"] || ""), tenant: String(request.headers["x-tenant-id"] || "") })
    response.writeHead(202, { "Content-Type": "application/json", ETag: '"2"' }); response.end(JSON.stringify({ status: "unknown", tenantId: tenant }))
  })
  backend.listen(33119, "127.0.0.1"); await once(backend, "listening")
  try {
    const headers = { Origin: origin, "X-Tenant-Id": tenant, "Idempotency-Key": record, "If-Match": '"1"' }
    const result = await context.request.post(`${origin}/api/erp/fiscal/nfe/${record}/issue`, { headers, data: {} })
    expect(result.status()).toBe(202); expect(result.headers()["etag"]).toBe('"2"')
    expect(seen).toEqual([{ path: `/api/v1/fiscal/nfe/${record}/issue`, key: record, revision: '"1"', tenant }])
    expect((await context.request.post(`${origin}/api/erp/fiscal/nfe/${record}/issue`, { headers: { ...headers, Origin: "https://untrusted.example" }, data: {} })).status()).toBe(403)
    expect((await context.request.post(`${origin}/api/erp/fiscal/nfe/${record}/issue`, { headers: { ...headers, "X-Tenant-Id": record }, data: {} })).status()).toBe(409)
    expect(seen).toHaveLength(1)
    const production = await context.request.post(`${origin}/api/erp/production/orders/${record}/consumptions`, { headers, data: { productId: record, quantity: "1.000000", unitCost: "1.00", reason: "Consumo de teste" } })
    expect(production.status()).toBe(202)
    const commission = await context.request.put(`${origin}/api/erp/orders/${record}/commission`, { headers, data: { sellerStaffId: record, commissionRate: "5.0000", ipiRate: "0.0000", paymentDay: 10 } })
    expect(commission.status()).toBe(202)
    expect(seen.slice(1)).toEqual([
      { path: `/api/v1/production/orders/${record}/consumptions`, key: record, revision: '"1"', tenant },
      { path: `/api/v1/orders/${record}/commission`, key: record, revision: '"1"', tenant },
    ])
    expect((await context.request.post(`${origin}/api/erp/commissions/${record}`, { headers, data: {} })).status()).toBe(400)
    expect((await context.request.get(`${origin}/api/erp/production/orders?unknown=1`)).status()).toBe(400)
    expect(seen).toHaveLength(3)
  } finally { backend.closeAllConnections(); await new Promise<void>(resolve => backend.close(() => resolve())) }
})
