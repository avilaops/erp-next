import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant } from "./helpers/frontend-fixture"

const company = { legalName: "Empresa da fixture", taxId: "11222333000181", state: "SP", stateRegistration: "110042490114", taxRegime: "real", city: "São Paulo" }
const profile = { environment: "homologation", state: "SP", municipalityCode: "3550308", stateRegistration: company.stateRegistration, crt: 3, series: 8, certificateReference: "" }

test.beforeEach(async ({ context }) => installFrontendFixture(context))

test("preferências da empresa oferece acesso direto aos dados de emissão", async ({ page }) => {
  await page.route("**/api/erp/company", route => route.fulfill({ json: { tenantId: tenant, revision: 1, data: { ...company, substituteRegistrations: [] } } }))
  await page.goto("/preferencias/empresa")
  await expect(page.getByRole("link", { name: /Emissão de NF-e Preencher série, CRT e código IBGE do município/ })).toHaveAttribute("href", "/preferencias/fiscal")
})

test("perfil novo deixa série pendente e salva somente a escolha explícita nas preferências", async ({ page }) => {
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
  await expect(page.getByLabel("Código de regime tributário", { exact: true })).toHaveValue("3")
  await expect(page.getByLabel("Série da NF-e", { exact: true })).toHaveValue("")
  const pending = page.getByRole("region", { name: "Dados para preencher", exact: true })
  await expect(pending).toContainText("Código IBGE do município")
  await expect(pending).toContainText("Série da NF-e")
  const save = page.getByRole("button", { name: "Salvar configuração fiscal", exact: true })
  await page.getByLabel("Código IBGE do município", { exact: false }).fill("3550308")
  await expect(save).toBeDisabled()
  await page.getByLabel("Série da NF-e", { exact: true }).fill("8")
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
  await expect(page.getByRole("region", { name: "Dados para preencher", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Salvar configuração fiscal", exact: true })).toBeDisabled()
})
