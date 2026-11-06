import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant } from "./helpers/frontend-fixture"

const company = { legalName: "Empresa da fixture", taxId: "11222333000181", state: "SP", stateRegistration: "110042490114", taxRegime: "real", city: "São Paulo" }
const profile = { environment: "homologation", state: "SP", municipalityCode: "3550308", stateRegistration: company.stateRegistration, crt: 3, series: 8, certificateReference: "" }

test.beforeEach(async ({ context }) => installFrontendFixture(context))

test("configuração fiscal organiza as sete etapas e preserva o layout nos tamanhos aceitos", async ({ page }) => {
  await page.route("**/api/erp/company", route => route.fulfill({ json: { tenantId: tenant, data: company } }))
  await page.route("**/api/erp/fiscal/config", route => route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, revision: 1, canEdit: true, certificateVerified: true, data: profile } }))
  for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport)
    await page.goto("/preferencias/fiscal")
    const navigation = page.getByRole("navigation", { name: "Etapas da configuração fiscal", exact: true })
    await expect(navigation).toBeVisible()
    await expect(navigation.getByRole("link")).toHaveCount(7)
    await expect(page.locator("#fiscal-stage-1")).toBeVisible()
    await expect(page.locator("#fiscal-stage-7")).toContainText("ainda não possuem contrato de persistência")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test("usuário escolhe produção e informa a numeração sem transmitir uma nota", async ({page},testInfo) => {
  let saved: Record<string,unknown> = {...profile}
  let writes=0
  let emissions=0
  await page.route("**/api/erp/company",route=>route.fulfill({json:{tenantId:tenant,data:company}}))
  await page.route("**/api/erp/fiscal/config",route=>{
    if(route.request().method()==="PUT") {
      writes++
      expect(route.request().headers()["if-match"]).toBe('"1"')
      saved=route.request().postDataJSON()
    }
    return route.fulfill({headers:{ETag:writes?'"2"':'"1"'},json:{tenantId:tenant,revision:writes?2:1,canEdit:true,certificateVerified:true,data:saved}})
  })
  await page.route("**/api/erp/fiscal/nfe/**/issue",route=>{emissions++;return route.fulfill({status:500,json:{title:"Não deveria transmitir"}})})
  await page.setViewportSize({width:390,height:844})
  await page.goto("/preferencias/fiscal")
  await page.getByLabel("Ambiente",{exact:true}).selectOption("production")
  await expect(page.getByLabel("Próximo número da NF-e",{exact:false})).toHaveValue("")
  await expect(page.getByRole("button",{name:"Salvar configuração fiscal",exact:true})).toBeDisabled()
  await page.getByLabel("Próximo número da NF-e",{exact:false}).fill("500")
  await page.getByRole("button",{name:"Salvar configuração fiscal",exact:true}).click()
  await expect(page.getByText("Configuração fiscal salva no servidor. A transmissão é feita na nota fiscal.",{exact:true})).toBeVisible()
  expect(saved).toEqual({...profile,environment:"production",nextNumber:500})
  await page.reload()
  await expect(page.getByLabel("Ambiente",{exact:true})).toHaveValue("production")
  await expect(page.getByLabel("Próximo número da NF-e",{exact:false})).toHaveValue("500")
  expect(emissions).toBe(0)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await testInfo.attach("nfe-production-config-mobile",{body:await page.screenshot({fullPage:true}),contentType:"image/png"})
})

test("preferências da empresa oferece acesso direto aos dados de emissão", async ({ page }) => {
  await page.route("**/api/erp/company", route => route.fulfill({ json: { tenantId: tenant, revision: 1, data: { ...company, substituteRegistrations: [] } } }))
  await page.goto("/preferencias/empresa")
  await expect(page.getByRole("link", { name: /Emissão de NF-e Preencher série, CRT e código IBGE do município/ })).toHaveAttribute("href", "/preferencias/fiscal")
})

test("perfil novo deixa todos os campos vazios mesmo com cadastro completo e salva as escolhas do usuário", async ({ page }) => {
  let saved: Record<string, unknown> | undefined
  await page.route("**/api/erp/company", route => route.fulfill({ json: { tenantId: tenant, data: company } }))
  await page.route("**/api/erp/fiscal/config", route => {
    if (route.request().method() === "PUT") {
      expect(route.request().headers()["if-match"]).toBe('"0"')
      expect(route.request().headers()["x-tenant-id"]).toBe(tenant)
      saved = route.request().postDataJSON()
    }
    return route.fulfill({ headers: { ETag: saved ? '"1"' : '"0"' }, json: { tenantId: tenant, revision: saved ? 1 : 0, canEdit: true, certificateVerified: true, data: saved || null } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/preferencias/fiscal")
  await expect(page.getByText("Regime tributário cadastrado: Lucro Real", { exact: true })).toBeVisible()
  for (const field of ["UF do emitente", "Inscrição estadual", "Código IBGE do município", "Código de regime tributário", "Série da NF-e", "Ambiente"]) {
    await expect(page.getByLabel(field, { exact: false })).toHaveValue("")
  }
  const pending = page.getByRole("region", { name: "Dados para preencher", exact: true })
  await expect(pending).toContainText("Código IBGE do município")
  await expect(pending).toContainText("Série da NF-e")
  await expect(pending).toContainText("UF do emitente")
  await expect(pending).toContainText("Inscrição estadual")
  await expect(pending).toContainText("Código de regime tributário")
  await expect(pending).toContainText("Ambiente")
  const save = page.getByRole("button", { name: "Salvar configuração fiscal", exact: true })
  await page.getByLabel("UF do emitente", { exact: false }).fill("SP")
  await page.getByLabel("Inscrição estadual", { exact: false }).fill(company.stateRegistration)
  await page.getByLabel("Código IBGE do município", { exact: false }).fill("3550308")
  await page.getByLabel("Código de regime tributário", { exact: true }).selectOption("3")
  await expect(save).toBeDisabled()
  await page.getByLabel("Série da NF-e", { exact: true }).fill("8")
  await expect(save).toBeDisabled()
  await page.getByLabel("Ambiente", { exact: true }).selectOption("homologation")
  await expect(pending).toHaveCount(0)
  await save.click()
  await expect(page.getByText("Configuração fiscal salva no servidor. A transmissão é feita na nota fiscal.", { exact: true })).toBeVisible()
  expect(saved).toEqual(profile)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("regime ausente permanece pendente e aponta para o cadastro em Preferências", async ({ page }) => {
  await page.route("**/api/erp/company", route => route.fulfill({ json: { tenantId: tenant, data: { ...company, taxRegime: "" } } }))
  await page.route("**/api/erp/fiscal/config", route => route.fulfill({ headers: { ETag: '"0"' }, json: { tenantId: tenant, revision: 0, canEdit: true, certificateVerified: true, data: null } }))
  await page.goto("/preferencias/fiscal")
  await expect(page.getByLabel("Código de regime tributário", { exact: true })).toHaveValue("")
  await expect(page.getByRole("region", { name: "Dados para preencher", exact: true })).toContainText("Regime tributário no cadastro da empresa")
  await expect(page.getByRole("link", { name: "Preencher regime tributário", exact: true })).toHaveAttribute("href", "/preferencias/empresa/dados?secao=fiscal")
  await expect(page.getByRole("button", { name: "Salvar configuração fiscal", exact: true })).toBeDisabled()
})

test("perfil existente preserva a série salva e respeita acesso de consulta", async ({ page }) => {
  await page.route("**/api/erp/company", route => route.fulfill({ json: { tenantId: tenant, data: company } }))
  await page.route("**/api/erp/fiscal/config", route => route.fulfill({ headers: { ETag: '"4"' }, json: { tenantId: tenant, revision: 4, canEdit: false, certificateVerified: true, data: profile } }))
  await page.goto("/preferencias/fiscal")
  await expect(page.getByLabel("Série da NF-e", { exact: true })).toHaveValue("8")
  await expect(page.getByLabel("Série da NF-e", { exact: true })).toBeDisabled()
  await expect(page.getByLabel("UF do emitente", { exact: false })).toHaveValue("SP")
  await expect(page.getByLabel("Inscrição estadual", { exact: false })).toHaveValue(company.stateRegistration)
  await expect(page.getByLabel("Código IBGE do município", { exact: false })).toHaveValue("3550308")
  await expect(page.getByLabel("Código de regime tributário", { exact: true })).toHaveValue("3")
  await expect(page.getByLabel("Ambiente", { exact: true })).toHaveValue("homologation")
  await expect(page.getByRole("region", { name: "Dados para preencher", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Salvar configuração fiscal", exact: true })).toBeDisabled()
})
