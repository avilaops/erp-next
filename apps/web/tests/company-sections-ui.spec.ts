import { expect, test } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { origin, secret } from "../playwright.danfe.config"
import { companyFields, type CompanyData, type CompanySnapshot } from "../src/features/company/company-types"

const tenant = "11111111-1111-4111-8111-111111111111"
let snapshot: CompanySnapshot
let writes: { data: CompanyData; revision: string | undefined; tenant: string | undefined }[]
let conflict: boolean

test.beforeEach(async ({ context }) => {
  snapshot = {
    tenantId: tenant, revision: 1, canEdit: true,
    data: {
      ...Object.fromEntries(companyFields.map(field => [field, ""])) as Record<typeof companyFields[number], string>,
      legalName: "Empresa de teste", tradeName: "Empresa", personType: "juridica", taxId: "12345678000195",
      taxRegime: "simples", postalCode: "01001000", state: "SP", city: "São Paulo", street: "Praça da Sé", number: "1", district: "Centro",
      segments: ["Comércio"], substituteRegistrations: [],
    },
  }
  writes = []
  conflict = false
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "company-sections-fixture", tenantId: tenant, expiresAt: Date.now() + 3600_000 })), cipher.final()])
  await context.addCookies([{ name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" }])
  await context.route("**/api/erp/company", async route => {
    if (route.request().method() === "PUT") {
      const data = route.request().postDataJSON() as CompanyData
      writes.push({ data, revision: route.request().headers()["if-match"], tenant: route.request().headers()["x-tenant-id"] })
      if (conflict) return route.fulfill({ status: 412, json: { title: "Outra pessoa alterou o cadastro" } })
      snapshot = { ...snapshot, data, revision: snapshot.revision + 1 }
    }
    return route.fulfill({ json: snapshot, headers: { etag: `"revision-${snapshot.revision}"` } })
  })
})

test("marca salva e remove a logo da empresa sem alterar os dados cadastrais", async ({ page }) => {
  await page.goto("/preferencias/empresa/dados?secao=marca")
  await expect(page.getByRole("heading", { name: "Logo da empresa", exact: true })).toBeVisible()
  await page.getByLabel("Selecionar logo da empresa", { exact: true }).setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") })
  await expect(page.getByRole("alert").filter({ hasText: "Escolha PNG, JPG ou WebP" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Salvar alterações", exact: true })).toBeDisabled()
  expect(writes).toHaveLength(0)
  const png = await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 16; return canvas.toDataURL("image/png").split(",")[1] })
  await page.getByLabel("Selecionar logo da empresa", { exact: true }).setInputFiles({
    name: "logo.png", mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  })
  await expect(page.getByRole("img", { name: "Logo da empresa", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Salvar alterações", exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].data).toMatchObject({ legalName: "Empresa de teste", taxId: "12345678000195", logoDataUrl: expect.stringMatching(/^data:image\/png;base64,/) })
  await page.reload()
  await expect(page.getByRole("img", { name: "Logo da empresa", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Remover logo", exact: true }).click()
  await page.getByRole("button", { name: "Salvar alterações", exact: true }).click()
  await expect.poll(() => writes.length).toBe(2)
  expect(writes[1].data).toMatchObject({ logoDataUrl: "" })
  await page.reload()
  await expect(page.getByRole("img", { name: "Logo da empresa", exact: true })).toHaveCount(0)
  snapshot.canEdit = false
  await page.reload()
  await expect(page.getByLabel("Selecionar logo da empresa", { exact: true })).toBeDisabled()
})

test("menus omitem os subtítulos redundantes e preservam os destinos", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/preferencias/empresa/dados")
  await expect(page.getByRole("navigation", { name: "Módulos do ERP", exact: true })).toBeHidden()
  await page.getByRole("button", { name: "Abrir menu", exact: true }).click()
  const navigation = page.getByRole("navigation", { name: "Módulos e fluxos do ERP", exact: true })
  await navigation.getByRole("button", { name: "Cadastros", exact: true }).click()
  await expect(navigation.getByRole("heading", { name: "Operação", exact: true })).toHaveCount(0)
  await expect(navigation.getByRole("link", { name: "Produtos", exact: true })).toHaveAttribute("href", "/cadastros/produtos")
  await page.getByRole("button", { name: "Voltar aos módulos", exact: true }).click()
  await navigation.getByRole("button", { name: "Meu Negócio", exact: true }).click()
  await expect(navigation.getByRole("heading", { name: "Dashboards", exact: true })).toHaveCount(0)
  await expect(navigation.getByRole("link", { name: "Dashboard geral", exact: true })).toHaveAttribute("href", "/dashboards")
})

test("relatórios em MDX preservam ações e cabem no celular", async ({ page }) => {
  await page.route("**/api/erp/receivables?**", route => route.fulfill({ json: { data: [] } }))
  await page.route("**/api/erp/financial-payables?**", route => route.fulfill({ json: { data: [] } }))
  await page.route("**/api/erp/stock?**", route => route.fulfill({ json: { data: [], total: 0, offset: 0, limit: 100 } }))
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    for (const [route, title] of [["financeiro", "Relatório financeiro"], ["estoque", "Relatório de estoque"]]) {
      await page.goto("/relatorios/" + route)
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible()
      await expect(page.getByRole("button", { name: "Exportar CSV", exact: true })).toBeDisabled()
      await expect(page.locator(".erp-page-back")).toHaveAttribute("href", "/relatorios")
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }
  }
})

test("menu lateral mostra somente a seção selecionada e acompanha o histórico", async ({ page }) => {
  await page.goto("/preferencias/empresa/dados")
  await expect(page.getByRole("heading", { name: "Alterar dados da empresa", exact: true })).toBeVisible()
  await expect(page.getByLabel("Nome fantasia", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Celular", { exact: true })).toBeHidden()
  const navigation = page.getByRole("navigation", { name: "Seções dos dados da empresa" })
  for (const [label, section, heading] of [
    ["Endereço", "endereco", "Endereço"], ["Contatos", "contato", "Contato"],
    ["Dados fiscais e atividade", "fiscal", "Dados fiscais e atividade"],
    ["Inscrições substitutas", "inscricoes", "Inscrições estaduais substitutas"],
  ]) {
    await navigation.getByRole("button", { name: label, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`secao=${section}$`))
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeFocused()
    await expect(page.locator("[data-company-section]:visible")).toHaveCount(1)
    await expect(navigation.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true")
  }
  await page.goBack()
  await expect(page.getByRole("combobox", { name: "Regime tributário *", exact: true })).toBeVisible()
  await page.goForward()
  await expect(page.getByRole("button", { name: "Adicionar inscrição", exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("button", { name: "Adicionar inscrição", exact: true })).toBeVisible()
  expect(writes).toHaveLength(0)
  await page.goto("/preferencias/empresa/dados?secao=inexistente")
  await expect(page.getByLabel("Nome fantasia", { exact: true })).toBeVisible()
})

test("trocar seções preserva a edição e salvar envia todos os campos com a revisão", async ({ page }) => {
  await page.goto("/preferencias/empresa/dados")
  const navigation = page.getByRole("navigation", { name: "Seções dos dados da empresa" })
  await page.getByLabel("Nome fantasia", { exact: true }).fill("Nome atualizado")
  await navigation.getByRole("button", { name: "Endereço", exact: true }).click()
  await page.getByLabel("Complemento", { exact: true }).fill("Sala 2")
  await navigation.getByRole("button", { name: "Contatos", exact: true }).click()
  await page.getByLabel("Celular", { exact: true }).fill("11999999999")
  page.once("dialog", dialog => dialog.dismiss())
  await page.locator("main").getByRole("link", { name: "Preferências", exact: true }).click()
  await expect(page).toHaveURL(/secao=contato$/)
  await page.getByRole("button", { name: "Salvar alterações", exact: true }).click()
  await expect(page.getByText("Cadastro salvo no servidor.", { exact: true })).toBeVisible()
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({ revision: '"revision-1"', tenant, data: { tradeName: "Nome atualizado", complement: "Sala 2", mobile: "11999999999", legalName: "Empresa de teste", taxRegime: "simples", segments: ["Comércio"] } })
  expect(Object.keys(writes[0].data).sort()).toEqual([...companyFields, "segments", "substituteRegistrations"].sort())
  await page.reload()
  await expect(page.getByLabel("Celular", { exact: true })).toHaveValue("11999999999")
  await navigation.getByRole("button", { name: "Dados cadastrais", exact: true }).click()
  await expect(page.getByLabel("Nome fantasia", { exact: true })).toHaveValue("Nome atualizado")
  await navigation.getByRole("button", { name: "Endereço", exact: true }).click()
  await expect(page.getByLabel("Complemento", { exact: true })).toHaveValue("Sala 2")
})

test("validação abre a seção de um campo obrigatório oculto antes de gravar", async ({ page }) => {
  snapshot.data.taxRegime = ""
  await page.goto("/preferencias/empresa/dados?secao=contato")
  await page.getByLabel("Celular", { exact: true }).fill("11999999999")
  await page.getByRole("button", { name: "Salvar alterações", exact: true }).click()
  await expect(page).toHaveURL(/secao=fiscal$/)
  await expect(page.getByRole("combobox", { name: "Regime tributário *", exact: true })).toBeFocused()
  expect(writes).toHaveLength(0)
  await page.getByRole("combobox", { name: "Regime tributário *", exact: true }).selectOption("simples")
  await page.getByRole("checkbox", { name: "Comércio", exact: true }).uncheck()
  await page.getByRole("navigation", { name: "Seções dos dados da empresa" }).getByRole("button", { name: "Contatos", exact: true }).click()
  await page.getByRole("button", { name: "Salvar alterações", exact: true }).click()
  await expect(page).toHaveURL(/secao=fiscal$/)
  await expect(page.locator("main").getByRole("alert")).toContainText("Selecione ao menos um segmento")
  expect(writes).toHaveLength(0)
  await page.getByRole("checkbox", { name: "Comércio", exact: true }).check()
  await page.getByRole("button", { name: "Salvar alterações", exact: true }).click()
  await expect(page.getByText("Cadastro salvo no servidor.", { exact: true })).toBeVisible()
})

test("cancelar restaura também as alterações nas seções ocultas", async ({ page }) => {
  await page.goto("/preferencias/empresa/dados")
  const navigation = page.getByRole("navigation", { name: "Seções dos dados da empresa" })
  await page.getByLabel("Nome fantasia", { exact: true }).fill("Descartar nome")
  await navigation.getByRole("button", { name: "Inscrições substitutas", exact: true }).click()
  await page.getByRole("button", { name: "Adicionar inscrição", exact: true }).click()
  await navigation.getByRole("button", { name: "Contatos", exact: true }).click()
  await page.getByLabel("Celular", { exact: true }).fill("11999999999")
  await page.getByRole("button", { name: "Cancelar", exact: true }).click()
  await expect(page.getByLabel("Celular", { exact: true })).toHaveValue("")
  await navigation.getByRole("button", { name: "Dados cadastrais", exact: true }).click()
  await expect(page.getByLabel("Nome fantasia", { exact: true })).toHaveValue("Empresa")
  await navigation.getByRole("button", { name: "Inscrições substitutas", exact: true }).click()
  await expect(page.getByLabel("Estado da inscrição 2", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Salvar alterações", exact: true })).toBeDisabled()
  expect(writes).toHaveLength(0)
})

test("acesso de consulta permite mudar a seção sem habilitar edição", async ({ page }) => {
  snapshot.canEdit = false
  await page.goto("/preferencias/empresa/dados?secao=contato")
  await expect(page.getByLabel("Celular", { exact: true })).toBeDisabled()
  await page.getByRole("navigation", { name: "Seções dos dados da empresa" }).getByRole("button", { name: "Endereço", exact: true }).click()
  await expect(page.getByLabel("Complemento", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Complemento", { exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Salvar alterações", exact: true })).toBeDisabled()
  expect(writes).toHaveLength(0)
})

test("conflito preserva campos de outras seções e impede nova gravação", async ({ page }) => {
  conflict = true
  await page.goto("/preferencias/empresa/dados")
  await page.getByLabel("Nome fantasia", { exact: true }).fill("Edição local")
  const navigation = page.getByRole("navigation", { name: "Seções dos dados da empresa" })
  await navigation.getByRole("button", { name: "Contatos", exact: true }).click()
  await page.getByLabel("Celular", { exact: true }).fill("11999999999")
  await page.getByRole("button", { name: "Salvar alterações", exact: true }).click()
  await expect(page.locator("main").getByRole("alert")).toContainText("Outra pessoa alterou")
  await navigation.getByRole("button", { name: "Dados cadastrais", exact: true }).click()
  await expect(page.getByLabel("Nome fantasia", { exact: true })).toHaveValue("Edição local")
  await expect(page.getByRole("button", { name: "Salvar alterações", exact: true })).toBeDisabled()
  expect(writes).toHaveLength(1)
})

test("formulário por seção cabe no celular e no desktop nos dois temas", async ({ page }, testInfo) => {
  await page.goto("/preferencias/empresa/dados?secao=contato")
  for (const theme of ["light", "dark"]) {
    await page.evaluate(value => localStorage.setItem("erp-theme", value), theme)
    await page.reload()
    await expect(page.getByLabel("Celular", { exact: true })).toBeVisible()
    if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/)
    else await expect(page.locator("html")).not.toHaveClass(/dark/)
    for (const width of [320, 390, 915, 1600]) {
      await page.setViewportSize({ width, height: 950 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await expect(page.locator("[data-company-section]:visible")).toHaveCount(1)
      if (width === 915 || width === 390) {
        await page.evaluate(() => window.scrollTo(0, 0))
        await expect(page.getByRole("heading", { name: "Alterar dados da empresa", exact: true })).toBeInViewport()
        await page.screenshot({ path: testInfo.outputPath(`company-sections-${theme}-${width}.png`), fullPage: true })
      }
    }
  }
})

test("dashboard mostra quatro indicadores em duas colunas a 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.route("**/api/erp/dashboard?**", route => route.fulfill({ json: {
    tenantId: tenant, startDate: "2026-05-09", endDate: "2026-11-09",
    sales: { orders: 3 }, receivables: "1234567.89", purchasePayables: "0.00", products: 157,
    salesSeries: [{ month: "2026-11", orders: 3, amount: "201626.11" }],
  } }))
  await page.goto("/dashboards")
  const indicators = page.getByRole("region", { name: "Indicadores do dashboard" })
  await expect(indicators.getByText("R$ 1.234.567,89", { exact: true })).toBeVisible()
  const [first, second] = await indicators.locator(":scope > div").evaluateAll(cards => cards.map(card => ({ x: card.getBoundingClientRect().x, y: card.getBoundingClientRect().y })))
  expect(first.y).toBe(second.y)
  expect(second.x).toBeGreaterThan(first.x)
  await expect(page.getByText("Pedidos: 09/05/2026 a 09/11/2026.", { exact: false })).toBeVisible()
  const table = page.getByRole("table", { name: /Pedidos não cancelados/ })
  await expect(table.getByRole("cell", { name: "R$ 201.626,11", exact: true })).toBeVisible()
  expect(await table.evaluate(element => element.parentElement!.scrollWidth <= element.parentElement!.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
})
