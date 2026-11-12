import { expect, test, type Page } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

const root = "/cadastros/clientes-fornecedores"
const blank = () => ({ personType: "juridica", legalName: "Pessoa do servidor", tradeName: null, taxId: "52998224725", email: null, phone: null, isCustomer: true, isSupplier: false, status: "active", addresses: [], contacts: [], fiscal: null })
async function fixture(page: Page) {
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant, legalName: "Empresa teste" }, permissions: ["catalog.parties.read", "catalog.parties.manage"] } }))
  await page.route(/\/api\/erp\/parties\?/, route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: [], total: 0 } }))
}
async function fill(page: Page) {
  await page.getByRole("combobox", { name: "Tipo de pessoa", exact: true }).selectOption("fisica")
  await page.getByLabel("CPF ou CNPJ", { exact: true }).fill("52998224725")
  await page.getByLabel("Nome ou razão social", { exact: true }).fill("Pessoa declarada")
}
test.beforeEach(async ({ context }) => { await installFrontendFixture(context) })

for (const width of [360, 393, 1280]) test(`rascunho recupera campos fiscais e protege navegação em ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 852 })
  await fixture(page)
  await page.goto(`${root}/novo`)
  await fill(page)
  await page.getByRole("combobox", { name: "Classificação ICMS", exact: true }).selectOption("2")
  await expect(page.getByLabel("Inscrição estadual", { exact: true })).toBeDisabled()
  await expect.poll(() => page.evaluate(() => Object.values(sessionStorage).some(raw => raw.includes("Pessoa declarada")))).toBe(true)
  page.once("dialog", dialog => dialog.accept())
  await page.reload()
  await expect(page.getByText("Edição recuperada nesta aba. Confira os dados antes de salvar.")).toBeVisible()
  await expect(page.getByLabel("Nome ou razão social", { exact: true })).toHaveValue("Pessoa declarada")
  await expect(page.getByRole("combobox", { name: "Classificação ICMS", exact: true })).toHaveValue("2")
  page.once("dialog", dialog => dialog.dismiss())
  await page.getByRole("link", { name: "Voltar às pessoas", exact: true }).click()
  await expect(page).toHaveURL(/\/novo$/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`party-draft-${width}.png`), fullPage: true })
})

test("POST com resposta perdida conserva corpo e chave depois de recarregar", async ({ page }) => {
  await fixture(page)
  const writes: { body: string; key: string | undefined }[] = []
  await page.route(/\/api\/erp\/parties$/, async route => {
    writes.push({ body: route.request().postData()!, key: route.request().headers()["idempotency-key"] })
    if (writes.length === 1) await route.abort()
    else await route.fulfill({ status: 201, headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: { ...JSON.parse(writes[0].body), id: record, revision: 1 } } })
  })
  await page.route(`**/api/erp/parties/${record}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: { ...blank(), personType: "fisica", id: record, revision: 1 } } }))
  await page.goto(`${root}/novo`)
  await fill(page)
  await page.getByRole("button", { name: "Salvar pessoa", exact: true }).click()
  await expect(page.getByRole("button", { name: "Conferir gravação", exact: true })).toBeVisible()
  page.once("dialog", dialog => dialog.accept())
  await page.reload()
  await expect(page.getByLabel("Nome ou razão social", { exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Conferir gravação", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${record}$`))
  expect(writes).toHaveLength(2)
  expect(writes[1]).toEqual(writes[0])
})

test("revisão alterada no servidor preserva edição local e bloqueia sobrescrita", async ({ page }) => {
  await fixture(page)
  let revision = 1
  const writes: string[] = []
  await page.route(`**/api/erp/parties/${record}`, route => {
    if (route.request().method() !== "GET") writes.push(route.request().method())
    return route.fulfill({ headers: { ETag: `"${revision}"` }, json: { tenantId: tenant, canEdit: true, data: { ...blank(), id: record, revision } } })
  })
  await page.goto(`${root}/${record}/editar`)
  await page.getByLabel("Nome ou razão social", { exact: true }).fill("Edição preservada")
  await expect.poll(() => page.evaluate(() => Object.values(sessionStorage).some(raw => raw.includes("Edição preservada")))).toBe(true)
  revision = 2
  page.once("dialog", dialog => dialog.accept())
  await page.reload()
  await expect(page.getByLabel("Nome ou razão social", { exact: true })).toHaveValue("Edição preservada")
  await expect(page.getByRole("button", { name: "Salvar pessoa", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Recarregar cadastro", exact: true })).toBeVisible()
  expect(writes).toEqual([])
})

test("armazenamento bloqueado impede POST e informa como preservar os dados", async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException("Quota exceeded", "QuotaExceededError") } })
  await fixture(page)
  const writes: string[] = []
  await page.route(/\/api\/erp\/parties$/, route => { writes.push(route.request().method()); return route.fulfill({ status: 500, json: {} }) })
  await page.goto(`${root}/novo`)
  await fill(page)
  await page.getByRole("button", { name: "Salvar pessoa", exact: true }).click()
  await expect(page.getByText("Não foi possível proteger a gravação nesta aba. Libere o armazenamento do navegador e tente novamente.")).toBeVisible()
  expect(writes).toEqual([])
})

test("recusa definitiva do PUT permite corrigir e recuperar o rascunho", async ({ page }) => {
  await fixture(page)
  await page.route(`**/api/erp/parties/${record}`, route => route.request().method() === "PUT" ? route.fulfill({ status: 422, json: { title: "Confira os dados" } }) : route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: { ...blank(), id: record, revision: 1 } } }))
  await page.goto(`${root}/${record}/editar`)
  await page.getByLabel("Nome ou razão social", { exact: true }).fill("Primeira edição")
  await page.getByRole("button", { name: "Salvar pessoa", exact: true }).click()
  await expect(page.getByText("Confira os dados", { exact: true })).toBeVisible()
  await page.getByLabel("Nome ou razão social", { exact: true }).fill("Edição corrigida")
  await expect.poll(() => page.evaluate(() => Object.values(sessionStorage).some(raw => raw.includes("Edição corrigida")))).toBe(true)
  page.once("dialog", dialog => dialog.accept())
  await page.reload()
  await expect(page.getByLabel("Nome ou razão social", { exact: true })).toHaveValue("Edição corrigida")
  await expect(page.getByRole("button", { name: "Salvar pessoa", exact: true })).toBeEnabled()
})

for (const legacy of [false, true]) test(`histórico pede confirmação mesmo com armazenamento indisponível: ${legacy ? "fallback" : "Navigation API"}`, async ({ page }) => {
  if (legacy) await page.addInitScript(() => { Object.defineProperty(window, "navigation", { value: undefined, configurable: true }) })
  await page.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException("Quota exceeded", "QuotaExceededError") } })
  await fixture(page)
  await page.goto(root)
  await expect(page.getByRole("button", { name: "Buscar", exact: true })).toBeEnabled()
  await page.getByRole("link", { name: "Nova pessoa", exact: true }).click()
  await page.getByLabel("Nome ou razão social", { exact: true }).fill("Edição no histórico")
  const dialog = page.waitForEvent("dialog", { timeout: 5000 })
  const navigation = page.goBack({ waitUntil: "commit", timeout: 5000 }).catch(() => null)
  await (await dialog).dismiss()
  await navigation
  await expect(page).toHaveURL(/\/novo$/)
  await expect(page.getByLabel("Nome ou razão social", { exact: true })).toHaveValue("Edição no histórico")
})

test("expiração da sessão remove dados pessoais e impede recriar o rascunho", async ({ page }) => {
  await fixture(page)
  await page.goto(`${root}/novo`)
  await fill(page)
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith("erp:party-draft:")))).toBe(true)
  await page.route("**/api/erp/parties", route => route.fulfill({ status: 401, json: { title: "Sessão expirada" } }))
  await page.getByRole("button", { name: "Salvar pessoa", exact: true }).click()
  await expect(page.getByRole("link", { name: "Entrar com Avila Ops", exact: true })).toBeVisible()
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("erp:party-draft:")))).toEqual([])
})

test("nova sessão limpa rascunhos pessoais de sessões anteriores", async ({ page, context }) => {
  await fixture(page)
  await page.goto(`${root}/novo`)
  await fill(page)
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith("erp:party-draft:")))).toBe(true)
  await installFrontendFixture(context, undefined, tenant, "second-authenticated-session")
  await fixture(page)
  page.once("dialog", dialog => dialog.accept())
  await page.reload()
  await expect(page.getByLabel("Nome ou razão social", { exact: true })).toHaveValue("")
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("erp:party-draft:")))).toEqual([])
})
