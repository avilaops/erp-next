import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

test.beforeEach(async ({ context }) => installFrontendFixture(context))

test("rascunho antigo permite declaração CRT 3 explícita sem presumir decisões ou alíquotas", async ({ page }) => {
  const draft = { environment: "homologation", model: 55, operationNature: "Venda", taxRuleReference: "Instrução do responsável fiscal", recipient: { taxId: "11222333000181", legalName: "Cliente de teste", state: "SP", municipalityCode: "3549805", postalCode: "15035000", street: "Rua Teste", number: "1", district: "Centro" }, items: [{ code: "P1", description: "Produto", unit: "UN", ncm: "95069100", cfop: "5102", quantity: "1.0000", unitPrice: "100.0000000000", grossTotal: "100.00", origin: 0, csosn: null, icmsCst: "00", pisCst: "01", cofinsCst: "01" }], productsTotal: "100.00", payments: [{ code: "17", amount: "100.00", description: null }] }
  let saved: Record<string, unknown> | undefined
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["fiscal.nfe.read", "fiscal.nfe.manage"] } }))
  await page.route("**/api/erp/fiscal/readiness", route => route.fulfill({ json: { tenantId: tenant, profileConfigured: true, certificateVerified: false, canTransmit: false, productionEnabled: false, blockers: [] } }))
  await page.route(`**/api/erp/fiscal/nfe/${record}/emission`, route => route.fulfill({ status: 404, json: { title: "Sem emissão" } }))
  await page.route(`**/api/erp/fiscal/nfe/${record}`, route => {
    if (route.request().method() === "PUT") saved = route.request().postDataJSON()
    return route.fulfill({ headers: { ETag: saved ? '"2"' : '"1"' }, json: { tenantId: tenant, canEdit: true, data: { id: record, revision: saved ? 2 : 1, status: "draft", input: saved || draft, issuer: { legalName: "Empresa teste", profile: { crt: 3 } } } } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/fiscal/notas-saida/${record}`)
  await expect(page.getByLabel("CST do ICMS", { exact: true })).toHaveValue("00")
  await expect(page.getByLabel("Alíquota do ICMS (%)", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Adicionar declaração tributária CRT 3", exact: true }).click()
  for (const name of ["Destinatário contribuinte do ICMS", "Operação para consumidor final", "Incluir IPI na base do ICMS para consumidor final", "Excluir ICMS da base de PIS e COFINS"]) {
    await expect(page.getByRole("combobox", { name, exact: true })).toHaveValue("")
  }
  await expect(page.getByLabel("Alíquota do ICMS (%)", { exact: true })).toHaveValue("")
  await page.getByRole("combobox", { name: "Destinatário contribuinte do ICMS", exact: true }).selectOption("true")
  await page.getByRole("combobox", { name: "Operação para consumidor final", exact: true }).selectOption("false")
  await page.getByRole("combobox", { name: "Incluir IPI na base do ICMS para consumidor final", exact: true }).selectOption("false")
  await page.getByRole("combobox", { name: "Excluir ICMS da base de PIS e COFINS", exact: true }).selectOption("true")
  for (const [name, value] of [["Inscrição estadual do destinatário contribuinte", "110042490114"], ["Alíquota do ICMS (%)", "0"], ["Alíquota do PIS (%)", "1,65"], ["Alíquota da COFINS (%)", "7,6"], ["Alíquota do IPI (%)", "10"], ["CST do IPI (em branco para nota sem IPI)", "50"], ["Código de enquadramento do IPI", "999"], ["CST do IBS/CBS", "000"], ["Classificação tributária IBS/CBS", "000001"], ["Alíquota do IBS estadual (%)", "0,1"], ["Alíquota do IBS municipal (%)", "0"], ["Alíquota da CBS (%)", "0,9"], ["Valor do pagamento 1", "110"]]) {
    await page.getByLabel(name, { exact: true }).fill(value)
  }
  await expect(page.getByText("Total da NF-e com IPI declarado: R$ 110,00", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click()
  await expect(page.getByText("Rascunho salvo no servidor. Nenhuma nota foi transmitida.", { exact: true })).toBeVisible()
  expect(saved?.taxDeclaration).toEqual({ recipientTaxpayer: true, recipientStateRegistration: "110042490114", finalConsumer: false, icmsRate: "0.0000", pisRate: "1.6500", cofinsRate: "7.6000", ipiCst: "50", ipiFrameCode: "999", ipiRate: "10.0000", ipiInIcmsBase: false, icmsOutOfContributions: true, ibsCbs: { cst: "000", classCode: "000001", ibsStateRate: "0.1000", ibsCityRate: "0.0000", cbsRate: "0.9000" } })
  expect(saved?.payments).toEqual([{ code: "17", amount: "110.00", description: null }])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
