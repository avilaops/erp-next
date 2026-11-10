import { expect, test } from "@playwright/test"
import { installFrontendFixture, record, tenant } from "./helpers/frontend-fixture"

const party = { id: record, revision: 1, personType: "fisica", legalName: "Pessoa com nome completo bastante extenso para a listagem", tradeName: null, taxId: "52998224725", email: "contato.muito.longo@empresa-exemplo.test", phone: "11999999999", isCustomer: true, isSupplier: true, status: "active", addresses: [], contacts: [] }
const staff = { id: record, revision: 1, code: "EQ-001", name: "Funcionária com nome completo bastante extenso", jobTitle: "Analista de atendimento", email: "pessoa.muito.longa@empresa-exemplo.test", phone: "11988888888", isEmployee: true, isSeller: false, status: "active", profile: {} }

test.beforeEach(async ({ context, page }) => {
  await installFrontendFixture(context)
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant, legalName: "Empresa de teste" }, permissions: [] } }))
})

for (const width of [320, 390]) test(`listas de pessoas e equipe mantêm identidade e contato sem rolagem em ${width}px`, async ({ page }, info) => {
  await page.route(/\/api\/erp\/parties\?/, route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: [party], total: 1 } }))
  await page.route(/\/api\/erp\/staff\?/, route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: [staff], total: 1 } }))
  await page.setViewportSize({ width, height: 844 })
  for (const [url, name, identity, email, metadata] of [
    ["/cadastros/clientes-fornecedores", "Clientes e fornecedores", party.legalName, party.email, "Cliente e fornecedor"],
    ["/cadastros/funcionarios", "Funcionários", staff.name, staff.email, staff.jobTitle],
  ]) {
    await page.goto(url)
    const table = page.getByRole("table", { name, exact: true })
    await expect(table.getByRole("columnheader")).toHaveText(["Nome", "Contato"])
    await expect(table.getByRole("link", { name: identity, exact: true })).toHaveAttribute("title", identity)
    await expect(table.getByText(email, { exact: true })).toBeVisible()
    await expect(table.getByText(metadata, { exact: true }).filter({ visible: true })).toBeVisible()
    expect(await table.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true })
  }
})

for (const width of [320, 390]) test(`cadastro de funcionário recolhe documentos opcionais e preserva a gravação em ${width}px`, async ({ page }, info) => {
  let saved: Record<string, unknown> | undefined
  await page.route(/\/api\/erp\/staff\?/, route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: [], total: 0 } }))
  await page.route("**/api/erp/staff", route => {
    saved = route.request().postDataJSON()
    expect(route.request().headers()["idempotency-key"]).toMatch(/^[a-f0-9-]{36}$/)
    return route.fulfill({ status: 201, headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: { ...staff, ...saved } } })
  })
  await page.route(`**/api/erp/staff/${record}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: { ...staff, ...saved } } }))
  await page.setViewportSize({ width, height: 844 })
  await page.goto("/cadastros/funcionarios/novo")
  const documents = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "Dados pessoais e documentos" }) })
  await expect(documents).not.toHaveAttribute("open", "")
  await expect(page.getByLabel("CPF", { exact: true })).toBeHidden()
  const code = page.getByLabel("Código", { exact: true })
  const job = page.getByLabel("Cargo", { exact: true })
  expect((await code.boundingBox())!.y).toBe((await job.boundingBox())!.y)
  await page.getByLabel("Nome", { exact: true }).fill("Maria de teste")
  await code.fill("EQ-001")
  await job.fill("Analista")
  await page.getByLabel("E-mail", { exact: true }).fill("maria@example.test")
  await documents.locator("summary").click()
  await page.getByLabel("CPF", { exact: true }).fill("52998224725")
  await page.getByLabel("Data de nascimento", { exact: true }).fill("1990-01-02")
  await page.getByRole("button", { name: "Salvar cadastro", exact: true }).click()
  await expect.poll(() => saved).toMatchObject({ name: "Maria de teste", code: "EQ-001", jobTitle: "Analista", email: "maria@example.test", profile: { cpf: "52998224725", birthDate: "1990-01-02" } })
  await expect(page).toHaveURL(new RegExp(`/cadastros/funcionarios/${record}$`))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`staff-${width}.png`), fullPage: true })
})

for (const width of [320, 390]) test(`cadastro de pessoa mantém campos básicos compactos e complementos opcionais em ${width}px`, async ({ page }, info) => {
  let saved: Record<string, unknown> | undefined
  await page.route(`**/api/erp/parties/${record}`, route => {
    if (route.request().method() === "PUT") saved = route.request().postDataJSON()
    return route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: { ...party, ...saved } } })
  })
  await page.setViewportSize({ width, height: 844 })
  await page.goto(`/cadastros/clientes-fornecedores/${record}/editar`)
  await expect(page.getByRole("button", { name: "Adicionar endereço", exact: true })).toBeVisible()
  await expect(page.getByLabel("Endereço 1: Rua", { exact: true })).toHaveCount(0)
  const personType = page.getByRole("combobox", { name: "Tipo de pessoa", exact: true })
  const status = page.getByRole("combobox", { name: "Situação", exact: true })
  expect((await personType.boundingBox())!.y).toBe((await status.boundingBox())!.y)
  await page.getByLabel("Nome ou razão social", { exact: true }).fill("Nome atualizado")
  await page.getByRole("button", { name: "Salvar pessoa", exact: true }).click()
  await expect.poll(() => saved).toMatchObject({ legalName: "Nome atualizado", taxId: "52998224725", email: party.email, phone: party.phone, addresses: [], contacts: [] })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`party-${width}.png`), fullPage: true })
})
