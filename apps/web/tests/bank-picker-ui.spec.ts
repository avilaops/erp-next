import { test, expect, type Page } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

const path = "/cadastros/contas-financeiras"
const fixtureAccount = { id: record, revision: 7, code: "BANK-TEST", name: "Conta sintética", status: "active", notes: null, accountType: "bank", bank: "Banco legado particular", branch: "0012-X", accountNumber: "98765-4" }

const imageDiagnostics = new WeakMap<Page, string[]>()
test.beforeEach(async ({ context, baseURL, page }) => {
  await installFrontendFixture(context, baseURL)
  const entries: string[] = []
  imageDiagnostics.set(page, entries)
  page.on("response", response => { if (response.url().includes("/banks/")) entries.push(`HTTP ${response.status()} ${response.headers()["content-type"]} ${response.url()}`) })
  page.on("requestfailed", request => entries.push(`FAILED ${request.url()}: ${request.failure()?.errorText}`))
  page.on("console", message => { if (message.type() === "error") entries.push(`CONSOLE ${message.text()}`) })
})
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const images = await page.locator("img").evaluateAll(images => images.filter((image): image is HTMLImageElement => image instanceof HTMLImageElement).map(image => ({ src: image.getAttribute("src"), currentSrc: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight })))
    await testInfo.attach("bank-image-delivery", { body: [...(imageDiagnostics.get(page) || []), JSON.stringify(images)].join("\n"), contentType: "text/plain" })
  }
})

test("Banco entrega logos locais com MIME SVG e decodificação válida", async ({ page }) => {
  const diagnostics: string[] = []
  page.on("console", message => { if (message.type() === "error") diagnostics.push(message.text()) })
  page.on("requestfailed", request => diagnostics.push(`${request.url()}: ${request.failure()?.errorText}`))
  await page.goto("/entrar")
  for (const name of ["itau-unibanco-s-a", "nu-pagamentos-s-a", "banco-do-brasil-s-a", "banco-pan", "bank-of-america", "pagseguro-internet-s-a", "stone-pagamentos-s-a"]) {
    const source = `/banks/${name}.svg`
    const response = await page.request.get(source)
    expect(response.status(), source).toBe(200)
    expect(response.headers()["content-type"], source).toMatch(/^image\/svg\+xml(?:;|$)/)
    const decoded = await page.evaluate(async source => {
      const image = new Image()
      image.src = source
      try { await image.decode(); return { width: image.naturalWidth, height: image.naturalHeight, error: "" } }
      catch (error) { return { width: image.naturalWidth, height: image.naturalHeight, error: String(error) } }
    }, source)
    expect(decoded.error, `${source}: ${diagnostics.join("; ")}`).toBe("")
    expect(decoded.width, source).toBeGreaterThan(0)
    expect(decoded.height, source).toBeGreaterThan(0)
  }
})

async function accountFixture(page: Page, options: { bank?: string; canEdit?: boolean; reject?: boolean } = {}) {
  let account = { ...fixtureAccount, bank: options.bank ?? fixtureAccount.bank }
  const writes: Record<string, unknown>[] = []
  await page.route("**/api/erp/financial-accounts**", route => {
    const request = route.request()
    if (request.method() !== "GET") {
      const body = request.postDataJSON()
      writes.push(body)
      if (options.reject) return route.fulfill({ status: 422, json: { title: "Cadastro recusado pela fixture" } })
      account = { ...account, ...body, revision: account.revision + 1 }
    }
    const list = new URL(request.url()).pathname.endsWith("/financial-accounts") && request.method() === "GET"
    return route.fulfill({ headers: { ETag: `"${account.revision}"` }, json: { tenantId: tenant, canEdit: options.canEdit ?? true, data: list ? [account] : account, ...(list ? { total: 1 } : {}) } })
  })
  return writes
}

async function expectLoadedLogo(page: Page, name: string, container = "dl") {
  // next/image reassigns img.src during hydration to replay early errors. The
  // browser then serializes this DOM attribute as an absolute URL.
  // Cache Components also retains previous routes in hidden DOM trees.
  const logo = page.locator(`${container}:visible img[src$="/banks/${name}.svg"]`)
  await expect(logo).toBeVisible()
  await expect(logo).toHaveJSProperty("complete", true)
  await expect.poll(() => logo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  const source = new URL((await logo.getAttribute("src"))!, page.url())
  expect(source.origin).toBe(new URL(page.url()).origin)
}

test("Banco seleciona por código e teclado e grava somente nome sem alterar agência ou conta", async ({ page }) => {
  const writes = await accountFixture(page)
  await page.goto(`${path}/${record}/editar`)
  const bank = page.getByRole("combobox", { name: "Banco", exact: true })
  await bank.fill("341")
  await expect(page.getByRole("option", { name: "Itaú Unibanco S.A 341", exact: true })).toBeVisible()
  await bank.press("ArrowDown")
  const activeId = await bank.getAttribute("aria-activedescendant")
  expect(activeId).toBeTruthy()
  await expect(page.locator(`[id="${activeId}"]`)).toContainText("Itaú")
  await bank.press("Enter")
  await expect(bank).toHaveValue("Itaú Unibanco S.A")
  await expect(bank).toHaveAttribute("aria-expanded", "false")
  await expect(page.getByLabel("Agência", { exact: true })).toHaveValue("0012-X")
  await expect(page.getByLabel("Número da conta", { exact: true })).toHaveValue("98765-4")
  await page.getByRole("button", { name: "Salvar cadastro", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Conta sintética", exact: true })).toBeVisible()
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({ bank: "Itaú Unibanco S.A", branch: "0012-X", accountNumber: "98765-4", accountType: "bank" })
  expect(writes[0]).not.toHaveProperty("bankId")
  expect(writes[0]).not.toHaveProperty("bankCode")
  await expectLoadedLogo(page, "itau-unibanco-s-a")
})

test("Banco mantém nome legado e nome manual, com escape e tab sem seleção implícita", async ({ page }) => {
  const writes = await accountFixture(page)
  await page.goto(`${path}/${record}/editar`)
  const bank = page.getByRole("combobox", { name: "Banco", exact: true })
  await expect(bank).toHaveValue("Banco legado particular")
  await page.getByLabel("Observações", { exact: true }).fill("Preservar identificação anterior")
  await page.getByRole("button", { name: "Salvar cadastro", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Conta sintética", exact: true })).toBeVisible()
  expect(writes[0].bank).toBe("Banco legado particular")
  await page.getByRole("link", { name: "Editar cadastro", exact: true }).click()
  await bank.fill("Banco manual de teste")
  await expect(page.getByRole("status").filter({ hasText: "Nenhum banco encontrado" })).toBeVisible()
  await bank.press("ArrowDown")
  await bank.press("Enter")
  await expect(bank).toHaveValue("Banco manual de teste")
  await bank.click()
  await bank.press("Escape")
  await expect(bank).toHaveAttribute("aria-expanded", "false")
  await bank.press("Tab")
  await page.getByRole("button", { name: "Salvar cadastro", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Conta sintética", exact: true })).toBeVisible()
  expect(writes[1].bank).toBe("Banco manual de teste")
})

test("Banco preserva alias legado reconhecido ao salvar outro campo", async ({ page }) => {
  const writes = await accountFixture(page, { bank: "ITAU" })
  await page.goto(`${path}/${record}/editar`)
  await expect(page.getByRole("combobox", { name: "Banco", exact: true })).toHaveValue("ITAU")
  await page.getByLabel("Observações", { exact: true }).fill("Apenas observação")
  await page.getByRole("button", { name: "Salvar cadastro", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Conta sintética", exact: true })).toBeVisible()
  expect(writes[0].bank).toBe("ITAU")
})

for (const accountType of ["cash", "internal"]) test(`Banco limpa dados bancários ao trocar tipo para ${accountType}`, async ({ page }) => {
  const writes = await accountFixture(page)
  await page.goto(`${path}/${record}/editar`)
  const type = page.getByRole("combobox", { name: "Tipo de conta", exact: true })
  await type.selectOption(accountType)
  await expect(page.getByRole("combobox", { name: "Banco", exact: true })).toHaveCount(0)
  await type.selectOption("bank")
  await expect(page.getByRole("combobox", { name: "Banco", exact: true })).toHaveValue("")
  await expect(page.getByLabel("Agência", { exact: true })).toHaveValue("")
  await expect(page.getByLabel("Número da conta", { exact: true })).toHaveValue("")
  await type.selectOption(accountType)
  await page.getByRole("button", { name: "Salvar cadastro", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Conta sintética", exact: true })).toBeVisible()
  expect(writes[0]).toMatchObject({ accountType, bank: null, branch: null, accountNumber: null })
})

test("Banco responde a alias, mantém escolha após erro e suporta logo indisponível em 320px", async ({ page }) => {
  const writes = await accountFixture(page, { reject: true })
  await page.route("**/banks/*.svg", route => route.abort("failed"))
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto(`${path}/${record}/editar`)
  const bank = page.getByRole("combobox", { name: "Banco", exact: true })
  await bank.fill("bb")
  const option = page.getByRole("option", { name: "Banco do Brasil S.A 001", exact: true })
  await expect(option).toBeVisible()
  expect((await bank.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await option.click()
  await expect(bank).toHaveValue("Banco do Brasil S.A")
  await expect(page.locator('img[src$="/banks/banco-do-brasil-s-a.svg"]')).toHaveCount(0)
  await expect(bank.locator("..").locator("svg.lucide-landmark")).toBeVisible()
  await page.getByRole("button", { name: "Salvar cadastro", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Cadastro recusado pela fixture" })).toContainText("Cadastro recusado pela fixture")
  await expect(bank).toHaveValue("Banco do Brasil S.A")
  expect(writes[0].bank).toBe("Banco do Brasil S.A")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("Banco apresenta identificação em detalhe e listagem somente consulta", async ({ page }) => {
  const writes = await accountFixture(page, { bank: "Nubank", canEdit: false })
  await page.goto(`${path}/${record}`)
  await expectLoadedLogo(page, "nu-pagamentos-s-a")
  await expect(page.getByRole("link", { name: "Editar cadastro", exact: true })).toHaveCount(0)
  await page.getByRole("link", { name: "Voltar à listagem", exact: true }).click()
  await expectLoadedLogo(page, "nu-pagamentos-s-a", "tbody")
  expect(writes).toHaveLength(0)
})
