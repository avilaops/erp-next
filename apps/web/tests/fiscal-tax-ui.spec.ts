import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"
import { blankDraft, blankItem, blankTaxDeclaration } from "../src/features/fiscal/nfe-draft-model"
import { ludusProfiles } from "../src/features/fiscal/settings/tax-profile-model"

test.beforeEach(async ({ context }) => installFrontendFixture(context))

test("perfis atualizam ao voltar do gerenciamento sem aplicar ao rascunho e descartam falhas", async ({ page }) => {
  let profiles = ludusProfiles()
  let fail = false
  let calls = 0
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["fiscal.nfe.read", "fiscal.nfe.manage"] } }))
  await page.route("**/api/erp/fiscal/readiness", route => route.fulfill({ json: { tenantId: tenant, profileConfigured: true, canTransmit: false, blockers: [] } }))
  await page.route(`**/api/erp/fiscal/nfe/${record}/emission`, route => route.fulfill({ status: 404, json: { title: "Sem emissão" } }))
  await page.route(`**/api/erp/fiscal/nfe/${record}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: { id: record, revision: 1, status: "draft", input: { ...blankDraft(), operationNature: "Natureza preservada" }, issuer: { legalName: "Empresa teste", profile: { crt: 3 } } } } }))
  await page.route("**/api/erp/registration-settings/tax-profiles", route => {
    calls++
    return fail ? route.fulfill({ status: 503, json: { title: "Consulta de perfis indisponível" } }) : route.fulfill({ json: { tenantId: tenant, revision: calls, data: { profiles } } })
  })
  await page.goto(`/fiscal/notas-saida/${record}`)
  await page.getByRole("button", { name: "4. Tributação", exact: true }).click()
  const picker = page.getByRole("region", { name: "Perfil tributário", exact: true })
  const select = picker.getByLabel("Perfil cadastrado")
  await select.selectOption({ label: profiles[0].name })
  profiles = [profiles[1], profiles[0], { ...profiles[0], name: "Perfil novo", active: false }]
  const before = calls
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect.poll(() => calls).toBeGreaterThan(before)
  await expect(select).toHaveValue(profiles[1].name)
  await expect(select.locator("option")).toHaveCount(3)
  await expect(picker.getByRole("status")).toHaveCount(0)
  fail = true
  await picker.getByRole("button", { name: "Atualizar perfis", exact: true }).click()
  await expect(picker.getByRole("alert")).toHaveText("Consulta de perfis indisponível")
  await expect(select.locator("option")).toHaveCount(1)
  await expect(picker.getByRole("button", { name: "Aplicar perfil à nota", exact: true })).toBeDisabled()
  fail = false
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect(select.locator("option")).toHaveCount(3)
  await expect(picker.getByRole("alert")).toHaveCount(0)
  await page.getByRole("button", { name: "1. Dados da nota", exact: true }).click()
  await expect(page.getByLabel("Natureza da operação", { exact: true })).toHaveValue("Natureza preservada")
})

test("frete, desconto e alíquotas do destino persistem sem alterar o preço bruto", async ({ page }) => {
  const draft = {
    ...blankDraft(),
    operationNature: "Venda de mercadoria",
    taxRuleReference: "Instrução fiscal sintética",
    recipient: { taxId: "11222333000181", legalName: "Cliente de teste", state: "MG", municipalityCode: "3106200", postalCode: "30110000", street: "Rua Teste", number: "1", district: "Centro" },
    items: [{ ...blankItem(), code: "P1", description: "Produto", unit: "UN", ncm: "95069100", cfop: "6108", unitPrice: "100.0000000000", grossTotal: "100.00", origin: 0, icmsCst: "00", pisCst: "01", cofinsCst: "01" }],
    productsTotal: "100.00",
    payments: [{ code: "17", amount: "110.00", description: null }],
    taxDeclaration: { ...blankTaxDeclaration(), recipientTaxpayer: false, finalConsumer: true, ipiInIcmsBase: true, icmsOutOfContributions: true, icmsRate: "12.0000", pisRate: "1.6500", cofinsRate: "7.6000", ipiCst: "50", ipiFrameCode: "999", ipiRate: "10.0000", ibsCbs: { cst: "000", classCode: "000001", ibsStateRate: "0.1000", ibsCityRate: "0.0000", cbsRate: "0.9000" } },
  }
  let saved: Record<string, unknown> | undefined
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["fiscal.nfe.read", "fiscal.nfe.manage"] } }))
  await page.route("**/api/erp/fiscal/readiness", route => route.fulfill({ json: { tenantId: tenant, profileConfigured: true, canTransmit: false, blockers: [] } }))
  await page.route(`**/api/erp/fiscal/nfe/${record}/emission`, route => route.fulfill({ status: 404, json: { title: "Sem emissão" } }))
  await page.route(`**/api/erp/fiscal/nfe/${record}`, route => {
    if (route.request().method() === "PUT") saved = route.request().postDataJSON()
    return route.fulfill({ headers: { ETag: saved ? '"2"' : '"1"' }, json: { tenantId: tenant, canEdit: true, data: { id: record, revision: saved ? 2 : 1, status: "draft", input: saved || draft, issuer: { legalName: "Empresa teste", profile: { crt: 3 } } } } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/fiscal/notas-saida/${record}`)
  await page.getByRole("button", { name: "3. Produtos", exact: true }).click()
  await page.getByRole("combobox", { name: "Frete por conta", exact: true }).selectOption("0")
  await page.getByText("Frete, seguro, desconto e informações do item 1", { exact: true }).click()
  await page.getByLabel("Frete do item 1 (R$)", { exact: true }).fill("20,00")
  await page.getByLabel("Desconto incondicional do item 1 (R$)", { exact: true }).fill("5")
  await page.getByRole("button", { name: "4. Tributação", exact: true }).click()
  await page.getByText("ICMS e FCP do destino · DIFAL", { exact: true }).click()
  for (const [name, value] of [["Alíquota interna do ICMS no destino (%)", "20"], ["Alíquota do FCP no destino (%)", "2"]]) {
    await page.getByLabel(name, { exact: true }).fill(value)
  }
  await page.getByRole("button", { name: "5. Pagamento", exact: true }).click()
  await page.getByLabel("Valor do pagamento 1", { exact: true }).fill("126,50")
  await page.getByRole("button", { name: "6. Revisão e emissão", exact: true }).click()
  await expect(page.getByText("Total da NF-e: R$ 126,50", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click()
  await expect(page.getByText("Rascunho salvo no servidor. Nenhuma nota foi transmitida.", { exact: true })).toBeVisible()
  expect(saved).toMatchObject({ freightMode: "0", productsTotal: "100.00", items: [{ unitPrice: "100.0000000000", grossTotal: "100.00", freightAmount: "20.00", discountAmount: "5.00" }], taxDeclaration: { destinationIcmsRate: "20.0000", destinationFcpRate: "2.0000" }, payments: [{ amount: "126.50" }] })
  await page.reload()
  await page.getByRole("button", { name: "3. Produtos", exact: true }).click()
  await page.getByText("Frete, seguro, desconto e informações do item 1", { exact: true }).click()
  await expect(page.getByLabel("Frete do item 1 (R$)", { exact: true })).toHaveValue("20.00")
  await page.getByRole("button", { name: "4. Tributação", exact: true }).click()
  await expect(page.getByLabel("Alíquota do FCP no destino (%)", { exact: true })).toHaveValue("2.0000")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

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
  await page.getByRole("button", { name: "4. Tributação", exact: true }).click()
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
  await page.getByText("IBS e CBS declarados", { exact: true }).click()
  for (const [name, value] of [["Inscrição estadual do destinatário contribuinte", "110042490114"], ["Alíquota do ICMS (%)", "0"], ["Alíquota do PIS (%)", "1,65"], ["Alíquota da COFINS (%)", "7,6"], ["Alíquota do IPI (%)", "10"], ["CST do IPI (em branco para nota sem IPI)", "50"], ["Código de enquadramento do IPI", "999"], ["CST do IBS/CBS", "000"], ["Classificação tributária IBS/CBS", "000001"], ["Alíquota do IBS estadual (%)", "0,1"], ["Alíquota do IBS municipal (%)", "0"], ["Alíquota da CBS (%)", "0,9"]]) {
    await page.getByLabel(name, { exact: true }).fill(value)
  }
  await page.getByRole("button", { name: "5. Pagamento", exact: true }).click()
  await page.getByLabel("Valor do pagamento 1", { exact: true }).fill("110")
  await page.getByRole("button", { name: "6. Revisão e emissão", exact: true }).click()
  await expect(page.getByText("Total da NF-e: R$ 110,00", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click()
  await expect(page.getByText("Rascunho salvo no servidor. Nenhuma nota foi transmitida.", { exact: true })).toBeVisible()
  expect(saved?.taxDeclaration).toEqual({ recipientTaxpayer: true, recipientStateRegistration: "110042490114", finalConsumer: false, icmsRate: "0.0000", pisRate: "1.6500", cofinsRate: "7.6000", ipiCst: "50", ipiFrameCode: "999", ipiRate: "10.0000", ipiInIcmsBase: false, icmsOutOfContributions: true, ibsCbs: { cst: "000", classCode: "000001", ibsStateRate: "0.1000", ibsCityRate: "0.0000", cbsRate: "0.9000" } })
  expect(saved?.payments).toEqual([{ code: "17", amount: "110.00", description: null }])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
