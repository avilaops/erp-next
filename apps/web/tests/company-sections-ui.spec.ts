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
