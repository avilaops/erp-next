import { test, expect, type Page, type BrowserContext } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

const key = "35261004252011000110550010000000011000000017"

async function fixture(page: Page, context: BrowserContext) {
  await installFrontendFixture(context)
  let saved: Record<string, unknown> | null = null
  const transmissions: string[] = []
  page.on("request", request => { if (/\/(issue|prepare|reconcile)$/.test(new URL(request.url()).pathname)) transmissions.push(request.url()) })
  const profile = { state: "SP", municipalityCode: "3549805", stateRegistration: "110042490114", environment: "homologation", crt: 1, series: 1, nextNumber: 123, certificateReference: "" }
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["fiscal.nfe.read", "fiscal.nfe.manage"] } }))
  await page.route("**/api/erp/fiscal/readiness", route => route.fulfill({ json: { tenantId: tenant, environment: "homologation", profileConfigured: true, certificateVerified: true, canTransmit: true, productionEnabled: false, blockers: [], crt: 1, series: 1 } }))
  await page.route("**/api/erp/fiscal/config", route => route.fulfill({ json: { tenantId: tenant, data: profile } }))
  await page.route("**/api/erp/fiscal/certificate", route => route.fulfill({ json: { tenantId: tenant, status: "active" } }))
  await page.route("**/api/erp/fiscal/settings/operation-natures", route => route.fulfill({ json: { tenantId: tenant, revision: 1, data: { items: [] } } }))
  await page.route("**/api/erp/registration-settings/tax-profiles", route => route.fulfill({ json: { tenantId: tenant, revision: 1, data: { profiles: [] } } }))
  await page.route("**/api/erp/financial-categories?*", route => route.fulfill({ json: { tenantId: tenant, data: [] } }))
  await page.route("**/api/erp/fiscal/nfe", async route => {
    if (route.request().method() !== "POST") return route.fulfill({ status: 405 })
    saved = route.request().postDataJSON()
    return route.fulfill({ status: 201, headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: { id: record, revision: 1, input: saved, issuer: { legalName: "Empresa sintética", profile } } } })
  })
  await page.route(`**/api/erp/fiscal/nfe/${record}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: { id: record, revision: 1, input: saved, issuer: { legalName: "Empresa sintética", profile } } } }))
  await page.route(`**/api/erp/fiscal/nfe/${record}/emission`, route => route.fulfill({ status: 404, json: { title: "Sem emissão" } }))
  await page.route(`**/api/erp/fiscal/nfe/${record}/events`, route => route.fulfill({ json: { tenantId: tenant, data: [] } }))
  return { saved: () => saved, transmissions }
}

async function fill(page: Page, values: readonly (readonly [string, string])[]) {
  for (const [label, value] of values) await page.getByLabel(label, { exact: true }).fill(value)
}
async function products(page: Page, cfop: string) {
  await page.getByRole("button", { name: "3. Produtos", exact: true }).click()
  await fill(page, [["Descrição do produto", "Mercadoria sintética"], ["Código do produto", "P1"], ["Unidade", "UN"], ["Quantidade", "1"], ["Preço unitário", "10"]])
  await page.getByRole("button", { name: "4. Tributação", exact: true }).click()
  await fill(page, [["NCM", "95069100"], ["CFOP", cfop], ["CST do PIS", "07"], ["CST da COFINS", "07"], ["CSOSN", "102"]])
  await page.getByLabel("Origem da mercadoria", { exact: true }).selectOption("0")
}

test("export modes expose the correct recipient and preserve declared unit conversion without inventing tax rates", async ({ page, context }) => {
  const state = await fixture(page, context)
  await page.goto("/fiscal/notas-saida/nova")
  await page.getByLabel("Série", { exact: true }).fill("7")
  await page.getByLabel("Número fiscal", { exact: true }).fill("321")
  await page.getByLabel("Código do regime tributário", { exact: true }).selectOption("1")
  await page.getByLabel("Tipo de saída", { exact: true }).selectOption("export")
  await expect(page.getByLabel("Modalidade de exportação", { exact: true })).toHaveValue("direct")
  await expect(page.getByLabel("UF de saída do país", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "2. Destinatário", exact: true }).click()
  await expect(page.getByLabel("Código do país (BACEN)", { exact: true })).toBeVisible()
  await expect(page.getByLabel("CPF/CNPJ", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "1. Dados da nota", exact: true }).click()
  await page.getByLabel("Modalidade de exportação", { exact: true }).selectOption("trading")
  await expect(page.getByLabel("UF de saída do país", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "2. Destinatário", exact: true }).click()
  await expect(page.getByLabel("CPF/CNPJ", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Código do país (BACEN)", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "1. Dados da nota", exact: true }).click()
  await page.getByLabel("Modalidade de exportação", { exact: true }).selectOption("indirect")
  await fill(page, [["Natureza da operação", "Exportação declarada"], ["Referência da instrução fiscal", "Instrução sintética"], ["Local de embarque ou transposição", "Porto de Santos"], ["Local de despacho", "Santos"]])
  await page.getByLabel("UF de saída do país", { exact: true }).selectOption("SP")
  await page.getByRole("button", { name: "2. Destinatário", exact: true }).click()
  await fill(page, [["Nome do destinatário", "Foreign Synthetic Buyer"], ["Identificação no exterior", "FOREIGN123"], ["Código do país (BACEN)", "2496"], ["País", "ESTADOS UNIDOS"], ["Cidade no exterior", "Boston"], ["Logradouro", "Synthetic Street"], ["Número", "10"], ["Bairro ou distrito", "Downtown"]])
  await products(page, "7102")
  await expect(page.getByLabel("Alíquota do ICMS (%)", { exact: true })).toHaveCount(0)
  await expect(page.getByLabel("Alíquota do PIS (%)", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "3. Produtos", exact: true }).click()
  await page.getByText("Frete, seguro, desconto e informações do item 1", { exact: true }).click()
  await fill(page, [["Unidade tributável de exportação", "KG"], ["Quantidade tributável", "4,0"], ["Preço unitário tributável", "2,5"]])
  await page.getByRole("button", { name: "Adicionar origem ou drawback", exact: true }).click()
  await fill(page, [["Chave da NF-e de origem", key], ["Quantidade comercial exportada", "0,5"]])
  await page.getByRole("button", { name: "6. Revisão e emissão", exact: true }).click()
  await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click()
  await expect.poll(state.saved).not.toBeNull()
  expect(state.saved()).toMatchObject({ series: 7, number: 321, crt: 1 })
  expect(state.saved()).toMatchObject({ model: 55, purpose: 1, exportation: { kind: "indirect", exitState: "SP", exportLocation: "Porto de Santos", dispatchLocation: "Santos" }, recipient: { taxId: "", state: "EX", municipalityCode: "9999999", foreignId: "FOREIGN123", countryCode: "2496", countryName: "ESTADOS UNIDOS" }, items: [{ quantity: "1.0000", unitPrice: "10.0000000000", taxableUnit: "KG", taxableQuantity: "4.0000", taxableUnitPrice: "2.5000000000", exportDetails: [{ referencedAccessKey: key, exportedQuantity: "0.5000", exportRegistration: "" }] }] })
  expect(state.saved()?.taxDeclaration).toBeUndefined()
  expect(state.transmissions).toEqual([])
})

test("simplified type 2 declares print type 6, final consumer and official consultation URLs without issuing", async ({ page, context }) => {
  const state = await fixture(page, context)
  await page.goto("/fiscal/notas-saida/nova")
  await page.getByLabel("Data e hora de saída", { exact: true }).fill("2026-11-08T12:00")
  await page.getByLabel("Tipo de saída", { exact: true }).selectOption("simplified")
  await expect(page.getByLabel("Data e hora de saída", { exact: true })).toHaveCount(0)
  await expect(page.getByLabel("Indicador de presença", { exact: true })).toHaveValue("1")
  await expect(page.getByLabel("Indicador de presença", { exact: true }).locator('option[value="2"]')).toHaveJSProperty("disabled", true)
  await fill(page, [["Natureza da operação", "Venda sintética"], ["Referência da instrução fiscal", "Instrução sintética"], ["URL oficial de consulta por QR Code", "https://www.fazenda.sp.gov.br/nfe/qrcode"], ["URL oficial de consulta por chave", "https://www.fazenda.sp.gov.br/nfe/consulta"]])
  await page.getByRole("button", { name: "2. Destinatário", exact: true }).click()
  await expect(page.getByLabel("Consumidor final", { exact: true })).toBeChecked()
  await expect(page.getByLabel("Consumidor final", { exact: true })).toBeDisabled()
  await fill(page, [["CPF/CNPJ", "11222333000181"], ["Nome ou razão social", "Cliente sintético"], ["Código IBGE do município", "3549805"], ["CEP", "15035000"], ["Logradouro", "Rua Sintética"], ["Número", "1"], ["Bairro", "Centro"]])
  await page.getByLabel("UF do destinatário", { exact: true }).selectOption("SP")
  await products(page, "5102")
  await page.getByRole("button", { name: "6. Revisão e emissão", exact: true }).click()
  await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click()
  await expect.poll(state.saved).not.toBeNull()
  expect(state.saved()).toMatchObject({ model: 55, printType: 6, purpose: 1, finalConsumer: true, presenceIndicator: 1, departureAt: null, exportation: null, simplifiedDanfe: { qrCodeUrl: "https://www.fazenda.sp.gov.br/nfe/qrcode", accessKeyUrl: "https://www.fazenda.sp.gov.br/nfe/consulta" } })
  expect(state.transmissions).toEqual([])
})

test("the authorized XML option opens the import archive without creating or issuing a draft", async ({ page, context }) => {
  const state = await fixture(page, context)
  await page.route("**/api/erp/fiscal/outgoing-imports?*", route => route.fulfill({ json: { tenantId: tenant, canImport: true, total: 0, data: [] } }))
  await page.goto("/fiscal/notas-saida/nova")
  await page.getByLabel("Tipo de saída", { exact: true }).selectOption("xml")
  await expect(page).toHaveURL(/\/fiscal\/notas-saida\/importar$/)
  await expect(page.getByRole("heading", { name: "Importar XML de saída", exact: true })).toBeVisible()
  expect(state.saved()).toBeNull()
  expect(state.transmissions).toEqual([])
})
