import { expect, test } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { origin, secret } from "../playwright.danfe.config"
import { preferenceCategories } from "../src/features/preferences-search/preferences-catalog"
import { existsSync } from "node:fs"
import path from "node:path"

test.beforeEach(async ({ context }) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "navigation-fixture-token", tenantId: "11111111-1111-4111-8111-111111111111", expiresAt: Date.now() + 3600_000 })), cipher.final()])
  await context.addCookies([{ name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" }])
})

test("preferências abre o índice pelo cabeçalho e só entra na empresa após escolher Geral", async ({ page }) => {
  await page.goto("/")
  await page.locator("header").getByRole("link", { name: "Preferências", exact: true }).click()
  await expect(page).toHaveURL(origin + "/preferencias")
  await expect(page.getByRole("heading", { name: "Preferências", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Escolha uma das opções abaixo", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Empresa", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("link", { name: "Alterar dados da empresa", exact: true })).toHaveAttribute("href", "/preferencias/empresa/dados")
  await page.getByRole("link", { name: "Geral", exact: true }).click()
  await expect(page).toHaveURL(origin + "/preferencias/empresa")
  await page.getByRole("link", { name: "Todas as preferências", exact: true }).click()
  await expect(page).toHaveURL(origin + "/preferencias")
  await page.reload()
  await expect(page.getByRole("heading", { name: "Preferências", exact: true })).toBeVisible()
})

test("todas as categorias das referências mostram opções e destinos existentes", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 915, height: 950 })
  await page.goto("/preferencias")
  await expect(page.getByRole("navigation", { name: "Categorias de preferências" }).getByRole("button")).toHaveText([
    "Empresa", "Sistema", "Cadastros", "Suprimentos", "Vendas", "Notas Fiscais", "Certificado Digital", "Finanças", "Serviços", "Integrações", "Logística", "Contabilidade", "Importações de Dados", "Backup e Exportação de Dados",
  ])
  for (const category of preferenceCategories) {
    const button = page.getByRole("button", { name: category.label, exact: true })
    await button.focus()
    await page.keyboard.press("Enter")
    await expect(button).toHaveAttribute("aria-pressed", "true")
    await expect(page).toHaveURL(origin + "/preferencias?categoria=" + category.id)
    await expect(page.locator("#preference-options").getByRole("heading", { name: category.label, exact: true })).toBeVisible()
    for (const item of category.sections.flatMap(section => section.items)) {
      const row = page.locator("#preference-options li").filter({ hasText: item.label }).filter({ has: page.getByText(item.label, { exact: true }) })
      if (item.href) {
        await expect(row.getByRole("link")).toHaveAttribute("href", item.href)
        expect(existsSync(path.resolve("src/app", item.href.slice(1), "page.tsx"))).toBe(true)
      } else {
        await expect(row.locator('[aria-disabled="true"]')).toBeVisible()
        await expect(row.getByRole("link")).toHaveCount(0)
      }
    }
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(page.getByRole("heading", { name: "Preferências", exact: true })).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath(`preferences-${category.id}.png`), fullPage: true })
  }
  await page.reload()
  await expect(page.getByRole("button", { name: "Backup e Exportação de Dados", exact: true })).toHaveAttribute("aria-pressed", "true")
  await page.goBack()
  await expect(page.getByRole("button", { name: "Importações de Dados", exact: true })).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: "Sistema", exact: true }).click()
  await page.locator("#preference-options").getByRole("link", { name: "Usuários", exact: true }).click()
  await expect(page).toHaveURL(origin + "/preferencias/usuarios")
})

test("pesquisa do índice de preferências ignora acentos e permite limpar resultado vazio", async ({ page }) => {
  await page.goto("/preferencias")
  const search = page.getByRole("searchbox", { name: "Pesquisar nas preferências", exact: true })
  await search.fill("  usuarios  ")
  await expect(page.getByRole("button", { name: "Sistema", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Empresa", exact: true })).toHaveCount(0)
  await expect(page.locator("#preference-options").getByRole("link", { name: "Usuários", exact: true })).toBeVisible()
  await search.fill("alterar dados")
  await expect(page.getByRole("link", { name: "Alterar dados da empresa", exact: true })).toBeVisible()
  await search.fill("configuração inexistente xyz")
  await expect(page.locator("main").getByRole("status")).toHaveText("Nenhuma configuração encontrada.")
  await page.getByRole("button", { name: "Limpar pesquisa", exact: true }).click()
  await expect(search).toHaveValue("")
  await expect(page.getByRole("button", { name: "Empresa", exact: true })).toBeVisible()
})

test("navegação móvel, módulos e busca global abrem o índice de preferências", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await page.getByRole("navigation", { name: "Navegação móvel", exact: true }).getByRole("link", { name: "Preferências", exact: true }).click()
  await expect(page).toHaveURL(origin + "/preferencias")
  await page.getByRole("button", { name: "Módulos", exact: true }).click()
  await page.getByRole("dialog").getByRole("link", { name: "Preferências", exact: true }).click()
  await expect(page).toHaveURL(origin + "/preferencias")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page.getByRole("button", { name: "Buscar", exact: true }).click()
  await page.getByRole("dialog").getByRole("combobox").fill("Preferências")
  await page.getByRole("option").filter({ has: page.getByText("Preferências", { exact: true }) }).click()
  await expect(page).toHaveURL(origin + "/preferencias")
  await expect(page.getByRole("dialog")).toHaveCount(0)
})

test("índice de preferências cabe no celular e no desktop em ambos os temas", async ({ page }, testInfo) => {
  await page.goto("/preferencias")
  for (const theme of ["light", "dark"]) {
    await page.evaluate(value => localStorage.setItem("erp-theme", value), theme)
    await page.reload()
    await expect(page.getByRole("heading", { name: "Preferências", exact: true })).toBeVisible()
    if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/)
    else await expect(page.locator("html")).not.toHaveClass(/dark/)
    for (const width of [320, 390, 915, 1599, 1600, 1749]) {
      await page.setViewportSize({ width, height: 950 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await page.getByRole("button", { name: "Empresa", exact: true }).click()
      await expect(page.getByRole("link", { name: "Geral", exact: true })).toBeVisible()
      if (width === 390 || width === 915 || width === 1749) await page.screenshot({ path: testInfo.outputPath(`preferences-overview-${theme}-${width}.png`), fullPage: true })
    }
  }
})

test("menu desktop é exclusivo, fecha fora e com Escape e mantém os painéis na janela", async ({ page }) => {
  await page.setViewportSize({ width: 1749, height: 950 })
  await page.goto("/")
  const navigation = page.getByRole("navigation", { name: "Módulos do ERP", exact: true })
  for (const name of ["Meu Negócio", "Cadastros", "Vendas", "Estoque", "Financeiro", "Operações", "Relatórios"]) {
    await navigation.locator("summary").filter({ hasText: name }).click()
    await expect(navigation.locator("details[open]")).toHaveCount(1)
    const panel = await navigation.locator("details[open] > div").boundingBox()
    expect(panel).not.toBeNull()
    expect(panel!.x).toBeGreaterThanOrEqual(0)
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(1749)
  }
  await page.keyboard.press("Escape")
  await expect(navigation.locator("details[open]")).toHaveCount(0)
  await expect(navigation.locator("summary").filter({ hasText: "Relatórios" })).toBeFocused()
  await navigation.locator("summary").filter({ hasText: "Cadastros" }).click()
  await page.getByRole("heading", { name: "Visão geral", exact: true }).click({ position: { x: 4, y: 4 } })
  await expect(navigation.locator("details[open]")).toHaveCount(0)
  await navigation.locator("summary").filter({ hasText: "Cadastros" }).click()
  await navigation.getByRole("link", { name: "Produtos", exact: true }).click()
  await expect(page).toHaveURL(/\/cadastros\/produtos$/)
  await expect(navigation.locator("details[open]")).toHaveCount(0)
})

test("cabeçalho cabe na janela e navegação compacta oferece os módulos em telas menores", async ({ page }) => {
  await page.goto("/")
  for (const width of [390, 1280, 1440, 1599, 1600, 1749]) {
    await page.setViewportSize({ width, height: 950 })
    await expect(page.getByRole("button", { name: "Sair", exact: true })).toBeVisible()
    const desktop = page.getByRole("navigation", { name: "Módulos do ERP", exact: true })
    const compact = page.getByRole("navigation", { name: "Navegação móvel", exact: true })
    if (width < 1600) { await expect(desktop).toBeHidden(); await expect(compact).toBeVisible() }
    else { await expect(desktop).toBeVisible(); await expect(compact).toBeHidden() }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
  await page.setViewportSize({ width: 1440, height: 950 })
  await page.getByRole("button", { name: "Módulos", exact: true }).click()
  const modules = page.getByRole("dialog")
  await expect(modules.getByRole("link", { name: "Produtos", exact: true })).toBeVisible()
  await modules.getByRole("link", { name: "Produtos", exact: true }).click()
  await expect(page).toHaveURL(/\/cadastros\/produtos$/)
  await expect(modules).toBeHidden()
})
