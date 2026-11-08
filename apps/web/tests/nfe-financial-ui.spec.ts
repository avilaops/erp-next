import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

const key = "35261004252011000110550010000000011000000017"
const profile = { state: "SP", municipalityCode: "3549805", stateRegistration: "110042490114", environment: "homologation", crt: 3, series: 1, nextNumber: 123, certificateReference: "" }

async function fixture(page: Page, context: BrowserContext) {
  await installFrontendFixture(context)
  let saved: Record<string, unknown> | null = null
  const transmissions: string[] = []
  const input = {
    model: 55, purpose: 1, environment: "homologation", operationNature: "Operação sintética declarada", taxRuleReference: "Instrução sintética", presenceIndicator: 9, printType: 1,
    recipient: { taxId: "11222333000181", legalName: "Destinatário sintético", state: "SP", municipalityCode: "3549805", postalCode: "15035000", street: "Rua Sintética", number: "1", district: "Centro" },
    items: [{ code: "P1", description: "Mercadoria sintética", unit: "UN", quantity: "1.0000", unitPrice: "10.0000000000", grossTotal: "10.00", ncm: "95069100", cfop: "5102", origin: 0, icmsCst: "41", csosn: null, pisCst: "07", cofinsCst: "07" }],
    productsTotal: "10.00", payments: [{ code: "90", amount: "0.00", description: null }],
    taxDeclaration: { recipientTaxpayer: false, recipientStateRegistration: null, finalConsumer: true, ipiInIcmsBase: false, icmsOutOfContributions: false, icmsRate: "0.0000", pisRate: "0.0000", cofinsRate: "0.0000", ipiRate: null, ipiCst: null, ipiFrameCode: null, ibsCbs: { cst: "000", classCode: "000001", ibsStateRate: "0.0000", ibsCityRate: "0.0000", cbsRate: "0.0000" } },
  }
  page.on("request", request => { if (/\/(issue|prepare|reconcile)$/.test(new URL(request.url()).pathname)) transmissions.push(request.url()) })
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["fiscal.nfe.read", "fiscal.nfe.manage"] } }))
  await page.route("**/api/erp/fiscal/readiness", route => route.fulfill({ json: { tenantId: tenant, environment: "homologation", profileConfigured: true, certificateVerified: true, canTransmit: false, productionEnabled: false, blockers: [], crt: 3, series: 1 } }))
  await page.route("**/api/erp/fiscal/config", route => route.fulfill({ json: { tenantId: tenant, data: profile } }))
  await page.route("**/api/erp/fiscal/certificate", route => route.fulfill({ json: { tenantId: tenant, status: "active" } }))
  await page.route("**/api/erp/fiscal/settings/operation-natures", route => route.fulfill({ json: { tenantId: tenant, revision: 1, data: { items: [] } } }))
  await page.route("**/api/erp/registration-settings/tax-profiles", route => route.fulfill({ json: { tenantId: tenant, revision: 1, data: { profiles: [] } } }))
  await page.route("**/api/erp/financial-categories?*", route => route.fulfill({ json: { tenantId: tenant, data: [] } }))
  await page.route(`**/api/erp/fiscal/nfe/${record}`, async route => {
    const writing = route.request().method() === "PUT"
    if (writing) saved = route.request().postDataJSON()
    return route.fulfill({ headers: { ETag: writing ? '"2"' : '"1"' }, json: { tenantId: tenant, canEdit: true, data: { id: record, revision: writing ? 2 : 1, input: writing ? saved : input, issuer: { legalName: "Emitente sintético CRT 3", profile } } } })
  })
  await page.route(`**/api/erp/fiscal/nfe/${record}/emission`, route => route.fulfill({ status: 404, json: { title: "Sem emissão" } }))
  await page.route(`**/api/erp/fiscal/nfe/${record}/events`, route => route.fulfill({ json: { tenantId: tenant, data: [] } }))
  await page.goto(`/fiscal/notas-saida/${record}`)
  await page.getByRole("button", { name: "1. Dados da nota", exact: true }).click()
  return { saved: () => saved, transmissions }
}

async function save(page: Page) {
  await page.getByRole("button", { name: "6. Revisão e emissão", exact: true }).click()
  await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click()
}
async function taxStep(page: Page, cfop: string) {
  await page.getByRole("button", { name: "4. Tributação", exact: true }).click()
  await page.getByLabel("CFOP", { exact: true }).fill(cfop)
}

test("credit 01 saves one header reference and exposes only implemented credit types", async ({ page, context }) => {
  const state = await fixture(page, context)
  await page.getByLabel("Finalidade fiscal", { exact: true }).selectOption("5")
  const types = page.getByLabel("Tipo de nota de crédito", { exact: true })
  for (const value of ["02", "05"]) await expect(types.locator(`option[value="${value}"]`)).toHaveJSProperty("disabled", true)
  for (const value of ["01", "03", "04", "06"]) await expect(types.locator(`option[value="${value}"]`)).toHaveJSProperty("disabled", false)
  await types.selectOption("01")
  await page.getByLabel("Chaves NF-e referenciadas", { exact: true }).fill(key)
  await taxStep(page, "1102")
  await expect(page.getByLabel("Chave do documento de origem do item 1", { exact: true })).toHaveCount(0)
  await save(page)
  await expect.poll(state.saved).not.toBeNull()
  expect(state.saved()).toMatchObject({ purpose: 5, creditType: "01", debitType: null, presenceIndicator: 0, referencedAccessKeys: [key], items: [{ cfop: "1102", referencedDfe: null }], payments: [{ code: "90", amount: "0.00" }] })
  expect(state.transmissions).toEqual([])
})

test("credit 06 saves item origin and item number without a header reference", async ({ page, context }) => {
  const state = await fixture(page, context)
  await page.getByLabel("Finalidade fiscal", { exact: true }).selectOption("5")
  await page.getByLabel("Tipo de nota de crédito", { exact: true }).selectOption("06")
  await expect(page.getByLabel("Chaves NF-e referenciadas", { exact: true })).toHaveCount(0)
  await taxStep(page, "1102")
  await page.getByLabel("Chave do documento de origem do item 1", { exact: true }).fill(key)
  await page.getByLabel("Número do item na nota de origem", { exact: true }).fill("7")
  await save(page)
  await expect.poll(state.saved).not.toBeNull()
  expect(state.saved()).toMatchObject({ purpose: 5, creditType: "06", debitType: null, referencedAccessKeys: [], items: [{ referencedDfe: { accessKey: key, itemNumber: 7 } }] })
  expect(state.transmissions).toEqual([])
})

test("debit 03 references the document without an item number and disables unsupported debit types", async ({ page, context }) => {
  const state = await fixture(page, context)
  await page.getByLabel("Finalidade fiscal", { exact: true }).selectOption("6")
  const types = page.getByLabel("Tipo de nota de débito", { exact: true })
  for (const value of ["01", "02", "05", "07", "08"]) await expect(types.locator(`option[value="${value}"]`)).toHaveJSProperty("disabled", true)
  for (const value of ["03", "04", "06"]) await expect(types.locator(`option[value="${value}"]`)).toHaveJSProperty("disabled", false)
  await types.selectOption("03")
  await taxStep(page, "5102")
  await page.getByLabel("Chave do documento de origem do item 1", { exact: true }).fill(key)
  await expect(page.getByLabel("Número do item na nota de origem", { exact: true })).toHaveCount(0)
  await save(page)
  await expect.poll(state.saved).not.toBeNull()
  expect(state.saved()).toMatchObject({ purpose: 6, creditType: null, debitType: "03", referencedAccessKeys: [], items: [{ referencedDfe: { accessKey: key } }] })
  const item = (state.saved()!.items as { referencedDfe: Record<string, unknown> }[])[0]
  expect(item.referencedDfe).not.toHaveProperty("itemNumber")
  expect(state.transmissions).toEqual([])
})

test("changing financial purpose and subtype clears incompatible references and types", async ({ page, context }) => {
  const state = await fixture(page, context)
  await page.getByLabel("Finalidade fiscal", { exact: true }).selectOption("5")
  await page.getByLabel("Tipo de nota de crédito", { exact: true }).selectOption("01")
  await page.getByLabel("Chaves NF-e referenciadas", { exact: true }).fill(key)
  await page.getByLabel("Tipo de nota de crédito", { exact: true }).selectOption("06")
  await expect(page.getByLabel("Chaves NF-e referenciadas", { exact: true })).toHaveCount(0)
  await taxStep(page, "1102")
  await page.getByLabel("Chave do documento de origem do item 1", { exact: true }).fill(key)
  await page.getByLabel("Número do item na nota de origem", { exact: true }).fill("3")
  await page.getByRole("button", { name: "1. Dados da nota", exact: true }).click()
  await page.getByLabel("Finalidade fiscal", { exact: true }).selectOption("6")
  await expect(page.getByLabel("Tipo de nota de débito", { exact: true })).toHaveValue("")
  await page.getByLabel("Tipo de nota de débito", { exact: true }).selectOption("03")
  await taxStep(page, "5102")
  await expect(page.getByLabel("Chave do documento de origem do item 1", { exact: true })).toHaveValue("")
  await expect(page.getByLabel("Número do item na nota de origem", { exact: true })).toHaveCount(0)
  await page.getByLabel("Chave do documento de origem do item 1", { exact: true }).fill(key)
  await page.getByRole("button", { name: "1. Dados da nota", exact: true }).click()
  await page.getByLabel("Finalidade fiscal", { exact: true }).selectOption("1")
  await expect(page.getByLabel("Tipo de nota de débito", { exact: true })).toHaveCount(0)
  await expect(page.getByLabel("Chaves NF-e referenciadas", { exact: true })).toHaveCount(0)
  await save(page)
  await expect.poll(state.saved).not.toBeNull()
  expect(state.saved()).toMatchObject({ purpose: 1, creditType: null, debitType: null, referencedAccessKeys: [], items: [{ referencedDfe: null }] })
  expect(state.transmissions).toEqual([])
})
