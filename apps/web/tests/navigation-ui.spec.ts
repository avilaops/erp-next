import { expect, test, type Page } from "@playwright/test"
import { listNavigationHref } from "../src/lib/list-navigation"

async function openPreferences(page: Page) {
  if ((page.viewportSize()?.width || 0) >= 900) {
    const navigation = page.getByRole("navigation", { name: "Módulos do ERP", exact: true })
    await navigation.getByRole("button", { name: "Preferências", exact: true }).click()
    await navigation.getByRole("link", { name: "Visão geral das preferências", exact: true }).click()
  } else {
    await page.getByRole("button", { name: "Abrir menu", exact: true }).click()
    const drawer = page.getByRole("dialog")
    await drawer.getByRole("button", { name: "Preferências", exact: true }).click()
    await drawer.getByRole("link", { name: "Visão geral das preferências", exact: true }).click()
  }
}


test("retorno compartilhado mantém filtros e recusa outro destino", () => {
  const listing = "/cadastros/clientes-fornecedores"
  const href = listNavigationHref(listing + "/novo", listing, "q=Maria&status=active&offset=25")
  const query = new URL(href, "https://erp.local").searchParams.toString()
  expect(listNavigationHref(listing, listing + "/novo", query)).toBe(listing + "?q=Maria&status=active&offset=25")
  expect(listNavigationHref(listing, listing + "/novo", "returnTo=https%3A%2F%2Fexterno.example")).toBe(listing)
  expect(listNavigationHref("/preferencias", listing, "q=Maria")).toBe("/preferencias")
})
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { origin, secret } from "../playwright.danfe.config"
import { preferenceCategories } from "../src/features/preferences/search/preferences-catalog"
import { existsSync } from "node:fs"
import path from "node:path"
import { desktopMenus } from "../src/components/shell/navigation-catalog"

test("recuperação de sessão desmonta toda a estrutura privada na página de acesso", async ({ page, context }) => {
  await page.route("**/api/erp/products?*", route => route.fulfill({ status: 401, json: { title: "Sessão expirada" } }))
  await page.goto("/cadastros/produtos")
  const login = page.getByRole("link", { name: "Entrar com Avila Ops", exact: true })
  await expect(login).toBeVisible()
  await context.clearCookies()
  await login.click()
  await expect(page).toHaveURL(/\/entrar\?/)
  await expect(page.locator(".entry-page")).toBeVisible()
  await expect(page.getByRole("navigation", { name: "Módulos do ERP", exact: true })).toHaveCount(0)
  await expect(page.locator(".erp-header")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Buscar no ERP", exact: true })).toHaveCount(0)
  for (const url of ["/api/erp/me", "/api/erp/products", "/api/erp/staff"]) expect((await context.request.get(url)).status()).toBe(401)
  const protectedPage = await context.request.get("/cadastros/funcionarios", { maxRedirects: 0 })
  expect(protectedPage.status()).toBe(307)
  expect(protectedPage.headers().location).toContain("/entrar?")
})

test("busca global encontra rótulos e grupos sem acentos e mostra estado vazio", async ({ page }) => {
  await page.goto("/preferencias")
  await page.getByRole("button", { name: "Buscar no ERP", exact: true }).click()
  const dialog = page.getByRole("dialog")
  const input = dialog.getByRole("combobox")
  await input.fill("  ANUNCIOS  ")
  await expect(dialog.getByRole("option")).toHaveCount(1)
  await expect(dialog.getByRole("option")).toContainText("Vendas / Canais e importação")
  await input.fill("documentos fiscais")
  await expect(dialog.getByRole("option").filter({ hasText: "DANFE" })).toHaveCount(1)
  await expect(dialog.getByRole("option").filter({ hasText: "NF-e" })).toHaveCount(1)
  await input.fill("funcionalidade inexistente xyz")
  await expect(dialog.getByText("Nenhum destino encontrado.")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "Buscar no ERP", exact: true })).toBeFocused()
})

test("navegação responsiva preserva espaço, rota ativa e foco em pedidos", async ({ page }, info) => {
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.route(/\/api\/erp\/me$/, route => route.fulfill({ json: {
    tenant: { id: "11111111-1111-4111-8111-111111111111", legalName: "Ávila Operações" }, permissions: [],
  } }))
  await page.route(/\/api\/erp\/orders\?/, route => route.fulfill({ json: {
    tenantId: "11111111-1111-4111-8111-111111111111", canEdit: false, total: 1,
    data: [{ id: "22222222-2222-4222-8222-222222222222", number: "17", customerName: "Cliente de teste", customerTaxId: "", dueDate: "2026-12-30", amount: "1250.00", status: "draft" }],
  } }))
  await page.goto("/vendas/pedidos")
  await expect(page.getByRole("table", { name: "Pedidos de venda" })).toBeVisible()
  // 720 x 450 also covers the layout space of a 1440 x 900 window at 200% zoom.
  for (const [width, height] of [[1440, 900], [930, 1000], [768, 1024], [390, 844], [720, 450]]) {
    await page.setViewportSize({ width, height })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    if (width >= 900) {
      const sidebar = page.getByRole("navigation", { name: "Módulos do ERP", exact: true })
      await expect(sidebar).toHaveCSS("width", width >= 1200 ? "224px" : "208px")
      await page.screenshot({ animations: "disabled", path: info.outputPath(`orders-${width}.png`) })
      const sales = sidebar.getByRole("button", { name: "Vendas", exact: true })
      await expect(sales).toHaveAttribute("data-active", "true")
      await expect(sales.locator(".erp-module-copy small")).toHaveText("Pedidos de venda")
      await expect(page.getByRole("link", { name: "Suas empresas", exact: true })).toContainText("Ávila Operações")
      await sales.focus()
      await page.keyboard.press("Tab")
      await page.keyboard.press("Shift+Tab")
      await expect(sales.locator(".erp-module-copy")).toBeVisible()
      if (await sales.getAttribute("aria-expanded") !== "true") await page.keyboard.press("Enter")
      const panel = page.locator("#erp-module-panel")
      await expect(panel.getByRole("link", { name: "Pedidos de venda", exact: true })).toHaveAttribute("aria-current", "page")
      await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0)
      const bounds = await panel.boundingBox()
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      await page.screenshot({ animations: "disabled", path: info.outputPath(`sales-panel-${width}.png`) })
      await page.keyboard.press("Escape")
      await expect(sales).toBeFocused()
    } else {
      const trigger = page.getByRole("button", { name: "Abrir menu", exact: true })
      await trigger.click()
      const drawer = page.getByRole("dialog")
      await expect(page.locator("body")).toHaveCSS("overflow", "hidden")
      await expect(drawer).toHaveCSS("opacity", "1")
      await page.screenshot({ animations: "disabled", path: info.outputPath(`mobile-modules-${width}.png`) })
      await drawer.getByRole("button", { name: "Vendas", exact: true }).click()
      await expect(drawer.getByRole("heading", { name: "Vendas", exact: true })).toBeFocused()
      await expect(drawer.getByRole("link", { name: "Pedidos de venda", exact: true })).toHaveAttribute("aria-current", "page")
      for (let step = 0; step < 18; step++) {
        await page.keyboard.press("Tab")
        await expect.poll(() => drawer.evaluate(element => element.contains(document.activeElement))).toBe(true)
      }
      await drawer.getByRole("button", { name: "Voltar aos módulos" }).focus()
      await page.screenshot({ animations: "disabled", path: info.outputPath(`mobile-sales-${width}.png`) })
      await page.keyboard.press("Escape")
      await expect(drawer).toBeHidden()
      await expect(trigger).toBeFocused()
    }
  }
  expect(errors).toEqual([])
})

test.beforeEach(async ({ context }) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "navigation-fixture-token", tenantId: "11111111-1111-4111-8111-111111111111", expiresAt: Date.now() + 3600_000 })), cipher.final()])
  await context.addCookies([{ name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" }])
})

test("preferências usa só a navegação lateral e mantém categorias no celular", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 950 })
  await page.goto("/preferencias?categoria=sistema")
  await expect(page.getByRole("navigation", { name: "Categorias de preferências" })).toHaveCount(0)
  const nav = page.getByRole("navigation", { name: "Módulos do ERP", exact: true })
  await expect(nav.getByRole("link", { name: "Sistema", exact: true })).toHaveAttribute("aria-current", "page")
  await expect(page.locator("#preference-category-title")).toHaveText("Sistema")
  await page.screenshot({ path: info.outputPath("preferences-single-navigation.png"), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "Abrir menu", exact: true }).click()
  const drawer = page.getByRole("dialog")
  await drawer.getByRole("button", { name: "Preferências", exact: true }).click()
  await drawer.getByRole("link", { name: "Serviços", exact: true }).click()
  await expect(page.locator("#preference-category-title")).toHaveText("Serviços")
  await expect(drawer).toBeHidden()
})


test("menu acompanha a categoria de preferências selecionada pela URL", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 950 })
  await page.goto("/preferencias?categoria=suprimentos")
  const navigation = page.getByRole("navigation", { name: "Módulos do ERP", exact: true })
  await expect(navigation.getByRole("link", { name: "Suprimentos", exact: true })).toHaveAttribute("aria-current", "page")
  await expect(navigation.getByRole("button", { name: "Preferências", exact: true }).locator("small")).toHaveText("Suprimentos")
  await navigation.getByRole("link", { name: "Notas Fiscais", exact: true }).click()
  await expect(navigation.getByRole("link", { name: "Notas Fiscais", exact: true })).toHaveAttribute("aria-current", "page")
  await expect(page.locator("#preference-category-title")).toHaveText("Notas Fiscais")
})

test("tipografia interna mantém escala 18/14/12 no desktop e celular", async ({ page }, info) => {
  await page.route("**/api/erp/staff**", route => route.fulfill({ json: {
    tenantId: "11111111-1111-4111-8111-111111111111", canEdit: false, total: 1,
    data: [{ id: "22222222-2222-4222-8222-222222222222", revision: 1, code: "EQ-001", name: "Maria da Silva", jobTitle: "Vendedor", isEmployee: true, isSeller: true, email: null, phone: null, status: "active" }],
  } }))
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 })
    await page.goto("/preferencias?categoria=sistema")
    const main = page.locator("main")
    await expect(main.getByRole("heading", { name: "Preferências", exact: true })).toHaveCSS("font-size", "18px")
    await expect(page.locator("#preference-category-title")).toHaveCSS("font-size", "18px")
    await expect(page.locator("#preference-options a").first()).toHaveCSS("font-size", "14px")
    await expect(page.locator("#preference-options .text-xs").first()).toHaveCSS("font-size", "12px")
    await expect(main.getByRole("searchbox")).toHaveCSS("font-size", "14px")
    await expect(main).toHaveCSS("font-family", /geist/i)
    await page.screenshot({ path: info.outputPath(`typography-preferences-${width}.png`), fullPage: true })
    await page.goto("/cadastros/funcionarios")
    await expect(main.getByRole("heading", { name: "Funcionários", exact: true })).toHaveCSS("font-size", "18px")
    await expect(main.getByRole("heading", { name: "Equipe cadastrada", exact: true })).toHaveCSS("font-size", "18px")
    await expect(main.getByRole("link", { name: "Maria da Silva", exact: true })).toHaveCSS("font-size", "14px")
    await expect(main.getByRole("textbox")).toHaveCSS("font-size", "14px")
    await expect(main.locator(".erp-page-header > p").last()).toHaveCSS("font-size", "14px")
    await page.screenshot({ path: info.outputPath(`typography-staff-${width}.png`), fullPage: true })
  }
})

test("menu móvel oferece os destinos do desktop e devolve o foco ao fechar", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1749, height: 900 })
  await page.goto("/preferencias")
  const desktop = page.getByRole("navigation", { name: "Módulos do ERP", exact: true })
  await expect(desktop).toBeVisible()
  const destinations: string[] = []
  for (const menu of desktopMenus) {
    await desktop.getByRole("button", { name: menu.label, exact: true }).click()
    destinations.push(...await desktop.locator("#erp-module-panel a[href]").evaluateAll(links => links.map(link => link.getAttribute("href")!)))
  }
  await page.setViewportSize({ width: 390, height: 844 })
  const trigger = page.getByRole("button", { name: "Abrir menu", exact: true })
  await trigger.click()
  const menu = page.getByRole("dialog")
  await expect(menu.getByRole("heading", { name: "Menu do ERP", exact: true })).toBeVisible()
  const mobileDestinations: string[] = []
  for (const category of desktopMenus) {
    await menu.getByRole("button", { name: category.label, exact: true }).click()
    mobileDestinations.push(...await menu.locator("a[href]").evaluateAll(links => links.map(link => link.getAttribute("href")!)))
    await menu.getByRole("button", { name: "Voltar aos módulos" }).click()
    await expect(menu.getByRole("button", { name: category.label, exact: true })).toBeFocused()
  }
  expect(mobileDestinations.sort()).toEqual(destinations.sort())
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await menu.getByRole("button", { name: "Cadastros", exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath("menu-celular-cadastros.png") })
  await menu.getByRole("link", { name: "Funcionários", exact: true }).click()
  await expect(page).toHaveURL(origin + "/cadastros/funcionarios", { timeout: 30_000 })
  await expect(menu).toBeHidden()
})

test("preferências oferece os cadastros e preserva os destinos das configurações cadastrais", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/preferencias?categoria=cadastros")
  const options = page.locator("#preference-options")
  await expect(options.getByRole("link", { name: /^Funcionários/ })).toHaveAttribute("href", "/cadastros/funcionarios")
  await expect(options.getByRole("link", { name: /^Produtos/ })).toHaveAttribute("href", "/cadastros/produtos")
  await expect(options.getByRole("link", { name: "Configurações de clientes e fornecedores", exact: true })).toHaveAttribute("href", "/preferencias/cadastros/clientes-fornecedores")
  await expect(options.getByRole("link", { name: "Configurações de produtos", exact: true })).toHaveAttribute("href", "/preferencias/cadastros/produtos")
  await expect(options.getByRole("link", { name: "Perfis tributários", exact: true })).toHaveAttribute("href", "/preferencias/cadastros/perfis-tributarios")
  await options.getByRole("link", { name: /^Clientes e fornecedores/ }).click()
  await expect(page).toHaveURL(origin + "/cadastros/clientes-fornecedores")
})

test("preferências abre o índice pelo menu e só entra na empresa após escolher Geral", async ({ page }) => {
  await page.goto("/")
  await openPreferences(page)
  await expect(page).toHaveURL(origin + "/preferencias")
  await expect(page.getByRole("heading", { name: "Preferências", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Escolha uma das opções abaixo", exact: true })).toBeVisible()
  await expect(page.locator("#preference-category-title")).toHaveText("Empresa")
  await expect(page.getByRole("link", { name: "Alterar dados da empresa", exact: true })).toHaveAttribute("href", "/preferencias/empresa/dados")
  await page.getByRole("link", { name: "Geral", exact: true }).click()
  await expect(page).toHaveURL(origin + "/preferencias/empresa")
  await expect(page.getByRole("navigation", { name: "Categorias de preferências" })).toHaveCount(0)
  await expect(page.locator("#conteudo-principal").getByRole("button", { name: "Preferências", exact: true })).toHaveCount(0)
  await page.getByRole("link", { name: "Todas as preferências", exact: true }).click()
  await expect(page).toHaveURL(origin + "/preferencias")
  await page.reload()
  await expect(page.getByRole("heading", { name: "Preferências", exact: true })).toBeVisible()
})

test("todas as categorias das referências mostram opções e destinos existentes", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 915, height: 950 })
  await page.goto("/preferencias")
  const navigation = page.getByRole("navigation", { name: "Módulos do ERP", exact: true })
  for (const category of preferenceCategories) {
    const link = navigation.getByRole("link", { name: category.label, exact: true })
    await link.focus()
    await page.keyboard.press("Enter")
    await expect(link).toHaveAttribute("aria-current", "page")
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
  await expect(page.getByRole("link", { name: "Backup e Exportação de Dados", exact: true })).toHaveAttribute("aria-current", "page")
  await page.goBack()
  await expect(page.getByRole("link", { name: "Importações de Dados", exact: true })).toHaveAttribute("aria-current", "page")
  await page.getByRole("link", { name: "Sistema", exact: true }).click()
  await expect(page.getByRole("link", { name: "Sistema", exact: true })).toHaveAttribute("aria-current", "page")
  await page.locator("#preference-options").getByRole("link", { name: "Usuários", exact: true }).click()
  await expect(page).toHaveURL(origin + "/preferencias/usuarios")
})

test("pesquisa do índice de preferências ignora acentos e permite limpar resultado vazio", async ({ page }) => {
  await page.goto("/preferencias")
  const search = page.getByRole("searchbox", { name: "Pesquisar nas preferências", exact: true })
  await search.fill("  usuarios  ")
  await expect(page.locator("#preference-category-title")).toHaveText("Sistema")
  await expect(page.getByRole("navigation", { name: "Categorias de preferências" })).toHaveCount(0)
  await expect(page.locator("#preference-options").getByRole("link", { name: "Usuários", exact: true })).toBeVisible()
  await search.fill("alterar dados")
  await expect(page.getByRole("link", { name: "Alterar dados da empresa", exact: true })).toBeVisible()
  await search.fill("configuração inexistente xyz")
  await expect(page.locator("main").getByRole("status")).toHaveText("Nenhuma configuração encontrada.")
  await page.getByRole("button", { name: "Limpar pesquisa", exact: true }).click()
  await expect(search).toHaveValue("")
  await expect(page.locator("#preference-category-title")).toHaveText("Empresa")
})

test("navegação móvel, módulos e busca global abrem o índice de preferências", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await openPreferences(page)
  await expect(page).toHaveURL(origin + "/preferencias")
  await page.getByRole("button", { name: "Abrir menu", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Índice completo", exact: true }).click()
  await page.getByRole("dialog").getByRole("link", { name: "Preferências", exact: true }).click()
  await expect(page).toHaveURL(origin + "/preferencias")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page.getByRole("button", { name: "Buscar no ERP", exact: true }).click()
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
      await expect(page.locator("#preference-category-title")).toHaveText("Empresa")
      await expect(page.getByRole("link", { name: "Geral", exact: true })).toBeVisible()
      if (width === 390 || width === 915 || width === 1749) await page.screenshot({ path: testInfo.outputPath(`preferences-overview-${theme}-${width}.png`), fullPage: true })
    }
  }
})

test("menu desktop mantém o módulo ativo aberto, fecha com Escape e cabe na janela", async ({ page }) => {
  await page.setViewportSize({ width: 1749, height: 950 })
  await page.goto("/")
  const navigation = page.getByRole("navigation", { name: "Módulos do ERP", exact: true })
  for (const name of desktopMenus.map(menu => menu.label)) {
    await navigation.getByRole("button", { name, exact: true }).click()
    await expect(navigation.locator("#erp-module-panel")).toHaveCount(1)
    const panel = await navigation.locator("#erp-module-panel").boundingBox()
    expect(panel).not.toBeNull()
    expect(panel!.x).toBeGreaterThanOrEqual(0)
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(1749)
  }
  await page.keyboard.press("Escape")
  await expect(navigation.locator("#erp-module-panel")).toHaveCount(0)
  await expect(navigation.getByRole("button", { name: "Preferências", exact: true })).toBeFocused()
  await navigation.getByRole("button", { name: "Cadastros", exact: true }).click()
  await page.locator("main").click({ position: { x: 1100, y: 10 } })
  await expect(navigation.locator("#erp-module-panel")).toHaveCount(1)
  await navigation.getByRole("link", { name: "Produtos", exact: true }).click()
  await expect(page).toHaveURL(/\/cadastros\/produtos$/, { timeout: 30_000 })
  await expect(navigation.locator("#erp-module-panel")).toHaveCount(1)
  await expect(navigation.getByRole("button", { name: "Cadastros", exact: true })).toHaveAttribute("data-active", "true")
  await page.reload()
  await expect(navigation.getByRole("button", { name: "Cadastros", exact: true })).toHaveAttribute("data-active", "true")
})

test("cabeçalho cabe na janela e navegação compacta oferece os módulos em telas menores", async ({ page }) => {
  await page.goto("/")
  for (const width of [320, 390, 768, 930, 1280, 1440, 1599, 1600, 1749]) {
    await page.setViewportSize({ width, height: 950 })
    await expect(page.getByRole("button", { name: "Sair", exact: true })).toBeVisible()
    const desktop = page.getByRole("navigation", { name: "Módulos do ERP", exact: true })
    const compact = page.getByRole("button", { name: "Abrir menu", exact: true })
    if (width < 900) { await expect(desktop).toBeHidden(); await expect(compact).toBeVisible() }
    else { await expect(desktop).toBeVisible(); await expect(compact).toBeHidden() }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
  await page.setViewportSize({ width: 1440, height: 950 })
  const toggles = page.getByRole("button", { name: "Recolher navegação", exact: true })
  await expect(toggles).toHaveCount(2)
  for (const toggle of await toggles.all()) {
    await expect(toggle).toHaveText("")
    await expect(toggle.locator("svg")).toHaveCount(1)
  }
  await page.getByRole("button", { name: "Recolher navegação", exact: true }).first().click()
  await expect(page.locator(".erp-sidebar")).toHaveCSS("width", "64px")
  await page.getByRole("button", { name: "Expandir navegação", exact: true }).last().click()
  await expect(page.locator(".erp-sidebar")).toHaveCSS("width", "224px")
  await page.getByRole("button", { name: "Cadastros", exact: true }).click()
  const modules = page.locator("#erp-module-panel")
  await expect(modules.getByRole("link", { name: "Produtos", exact: true })).toBeVisible()
  await modules.getByRole("link", { name: "Produtos", exact: true }).click()
  await expect(page).toHaveURL(/\/cadastros\/produtos$/, { timeout: 30_000 })
  await expect(modules).toBeVisible()
  await expect(modules.getByRole("link", { name: "Produtos", exact: true })).toHaveAttribute("aria-current", "page")
})

test("sidebar recolhida centraliza ícones e mantém controles e painel acessíveis", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 950 })
  await page.goto("/")
  const sidebar = page.getByRole("navigation", { name: "Módulos do ERP", exact: true })
  await sidebar.getByRole("button", { name: "Recolher navegação", exact: true }).first().click()
  await expect(sidebar).toHaveCSS("width", "64px")
  await expect(sidebar.locator(".erp-module-list")).toHaveCSS("border-top-width", "0px")
  for (const height of [950, 600]) {
    await page.setViewportSize({ width: 1440, height })
    const rail = (await sidebar.boundingBox())!
    for (const button of await sidebar.locator(".erp-module-list .erp-module-button").all()) {
      const box = (await button.boundingBox())!
      expect(box.width).toBe(44)
      expect(box.height).toBe(44)
      const icon = (await button.locator("svg").first().boundingBox())!
      expect(Math.abs(icon.x + icon.width / 2 - (rail.x + rail.width / 2))).toBeLessThanOrEqual(1)
    }
    for (const toggle of await sidebar.getByRole("button", { name: "Expandir navegação", exact: true }).all()) await expect(toggle).toBeInViewport()
  }
  await page.setViewportSize({ width: 1440, height: 950 })
  await sidebar.getByRole("button", { name: "Cadastros", exact: true }).click()
  await expect(sidebar.locator("#erp-module-panel").getByRole("link", { name: "Produtos", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(sidebar.getByRole("button", { name: "Cadastros", exact: true })).toBeFocused()
  await page.mouse.move(100, 100)
  await page.screenshot({ path: info.outputPath("sidebar-collapsed-aligned.png") })
  await sidebar.getByRole("button", { name: "Expandir navegação", exact: true }).last().click()
  await expect(sidebar).toHaveCSS("width", "224px")
  await expect(sidebar.locator(".erp-brand-name")).toBeVisible()
})

test("Preferências de Serviços abre os módulos existentes sem marcá-los como indisponíveis", async ({ page }) => {
  await page.goto("/preferencias?categoria=servicos")
  const options = page.locator("#preference-options")
  for (const [label, href] of [["Ordens de serviço", "/servicos/ordens"], ["NFS-e recebidas", "/servicos/notas"], ["CT-e recebidos", "/servicos/cte"], ["Cobranças", "/servicos/cobrancas"], ["Modelos de contratos", "/servicos/contratos/modelos"]]) {
    await expect(options.getByRole("link", { name: new RegExp(`^${label}`) })).toHaveAttribute("href", href)
  }
  await expect(options.getByText("Indisponível", { exact: true })).toHaveCount(0)
})

for (const scenario of [
  { path: "/cadastros/funcionarios", endpoint: "staff", table: "Funcionários", name: "Maria da Silva", row: { code: "EQ-001", name: "Maria da Silva", jobTitle: "Vendedor", isEmployee: true, isSeller: true } },
  { path: "/cadastros/clientes-fornecedores", endpoint: "parties", table: "Clientes e fornecedores", name: "Cliente Exemplo", row: { legalName: "Cliente Exemplo", taxId: "04252011000110", personType: "juridica", isCustomer: true, isSupplier: true } },
  { path: "/cadastros/produtos", endpoint: "products", table: "Catálogo de produtos", name: "Produto Exemplo", row: { name: "Produto Exemplo", sku: "TEST-001", unit: "UN", basePrice: "12.50" } },
  { path: "/cadastros/tags", endpoint: "tags", table: "Tags da empresa ativa", name: "Tag Exemplo", row: { name: "Tag Exemplo", code: "TAG-001" } },
]) test(`cadastros em lista: ${scenario.table}, com nome direto em desktop e celular`, async ({ page }, info) => {
  const id = "22222222-2222-4222-8222-222222222222"
  await page.route(`**/api/erp/${scenario.endpoint}**`, route => route.fulfill({ json: { tenantId: "11111111-1111-4111-8111-111111111111", canEdit: false, data: [{ id, revision: 1, status: "active", email: null, phone: null, ...scenario.row }], total: 1 } }))
  await page.goto(scenario.path)
  const table = page.getByRole("table", { name: scenario.table, exact: true })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(table).toBeVisible({ timeout: 30_000 })
    await expect(table.getByRole("link", { name: scenario.name, exact: true })).toHaveAttribute("href", `${scenario.path}/${id}`)
    await expect(table.getByRole("row")).toHaveCount(2)
    await expect(page.locator("main").getByRole("link", { name: /^Consultar / })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`registry-${scenario.endpoint}-${width}.png`), fullPage: true })
  }
})

test("cabeçalho sem preferências duplicadas e produtos com caminho de navegação", async ({ page }) => {
  await page.goto("/cadastros")
  await expect(page.locator(".erp-header").getByRole("link", { name: "Preferências", exact: true })).toHaveCount(0)
  await expect(page.locator("main").getByText(/As áreas abaixo consultam os registros/)).toHaveCount(0)
  await page.goto("/cadastros/produtos")
  const breadcrumb = page.getByRole("navigation", { name: "Caminho de navegação", exact: true })
  await expect(breadcrumb.getByRole("link", { name: "Cadastros", exact: true })).toHaveAttribute("href", "/cadastros")
  await expect(breadcrumb.getByRole("link", { name: "Produtos", exact: true })).toHaveAttribute("href", "/cadastros/produtos")
  await expect(breadcrumb.getByRole("link", { name: "Produtos", exact: true })).toHaveAttribute("aria-current", "page")
  await breadcrumb.getByRole("link", { name: "Cadastros", exact: true }).click()
  await expect(page).toHaveURL(origin + "/cadastros")
})
