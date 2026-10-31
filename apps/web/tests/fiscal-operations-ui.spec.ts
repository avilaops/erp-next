import { expect, test } from "@playwright/test"
import { createServer } from "node:http"
import { once } from "node:events"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"
import { origin } from "../playwright.danfe.config"

const draft = { environment: "homologation", model: 55, operationNature: "Venda", taxRuleReference: "Instrução de teste", recipient: { taxId: "11222333000181", legalName: "Cliente de teste", state: "SP", municipalityCode: "3549805", postalCode: "15035000", street: "Rua Teste", number: "1", district: "Centro" }, items: [{ code: "P1", description: "Produto", unit: "UN", ncm: "95069100", cfop: "5102", quantity: "1.0000", unitPrice: "100.0000000000", grossTotal: "100.00", origin: 0, csosn: "102", icmsCst: null, pisCst: "07", cofinsCst: "07" }], productsTotal: "100.00", payments: [{ code: "17", amount: "100.00", description: null }] }

test.beforeEach(async ({ context }) => installFrontendFixture(context))

test("emissão conserva comando em resposta incerta e eventos usam a revisão fiscal", async ({ page }) => {
  const calls: { key: string; revision: string; body: unknown }[] = []
  let issued = false, cancelled = false
  page.on("dialog", dialog => dialog.accept())
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["fiscal.nfe.read", "fiscal.nfe.manage", "fiscal.nfe.issue"] } }))
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
  } finally { backend.closeAllConnections(); await new Promise<void>(resolve => backend.close(() => resolve())) }
})
