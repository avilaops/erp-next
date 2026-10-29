import { expect, test } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { origin, secret } from "../playwright.danfe.config"

test.beforeEach(async ({ context }) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "frontend-controls-fixture", tenantId: "11111111-1111-4111-8111-111111111111", expiresAt: Date.now() + 3600_000 })), cipher.final()])
  await context.addCookies([{ name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" }])
  await context.route("**/api/erp/company", route => route.fulfill({ status: 503, json: { title: "Consulta da empresa indisponível" } }))
  await context.route("**/api/erp/products?*", route => route.fulfill({ json: { tenantId: "11111111-1111-4111-8111-111111111111", canEdit: true, data: [], total: 60 } }))
})

test("cabeçalho cabe em 320 px sem perder os acessos", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto("/")
  await expect(page.getByRole("button", { name: "Sair", exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await page.getByRole("link", { name: "Suas empresas", exact: true }).click({ trial: true })
  await page.getByRole("button", { name: "Buscar", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
})

test("preferências mobile abre painel e pesquisa filtra com vazio e limpeza", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/preferencias/empresa")
  const trigger = page.getByRole("button", { name: "Preferências", exact: true })
  await trigger.click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page.getByRole("dialog").getByRole("link", { name: "Certificado digital", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(trigger).toBeFocused()
  const search = page.getByRole("searchbox", { name: "Pesquisar nas preferências da empresa" })
  await search.fill("endereco")
  await expect(page.getByRole("link", { name: /Endereço fiscal e localização/ })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Governança e conexões", exact: true })).toHaveCount(0)
  await search.fill("zzzinexistente")
  await expect(page.getByText("Nenhuma configuração encontrada.", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Limpar pesquisa", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Governança e conexões", exact: true })).toBeVisible()
})

test("falha de consulta não apresenta configuração ou contagem presumida", async ({ page }) => {
  await page.setViewportSize({ width: 1749, height: 950 })
  await page.goto("/preferencias/empresa")
  await expect(page.getByText("Consulta da empresa indisponível", { exact: true })).toBeVisible()
  for (const label of ["Completo", "Ativa", "1 administrador", "Nenhuma ativa", "Não configurado"]) {
    await expect(page.locator("main").getByText(label, { exact: true })).toHaveCount(0)
  }
  await expect(page.locator("main").getByText("Não verificado", { exact: true }).first()).toBeVisible()
})

test("busca global encontra Produtos com destino direto", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /Pesquisar/ }).click()
  await page.getByRole("dialog").getByRole("combobox").fill("Produtos")
  await page.getByRole("option", { name: /^Produtos\b/ }).click({ timeout: 8000 })
  await expect(page).toHaveURL(/\/cadastros\/produtos$/)
})

test("histórico demonstrativo não oferece download inexistente", async ({ page }) => {
  await page.goto("/preferencias/dados/exportacao")
  await expect(page.getByRole("button", { name: "Baixar", exact: true }).first()).toBeDisabled()
  await expect(page.getByText("Downloads indisponíveis nesta demonstração. Nenhum arquivo foi gerado.", { exact: true })).toBeVisible()
})

test("filtro e página do catálogo sobrevivem a recarga e histórico", async ({ page }) => {
  await page.goto("/cadastros/produtos")
  const search = page.getByRole("textbox", { name: "Buscar nome ou SKU", exact: true })
  await search.fill("SKU teste")
  await page.getByRole("combobox", { name: "Situação", exact: true }).selectOption("archived")
  await page.locator("main").getByRole("button", { name: "Buscar", exact: true }).click()
  await expect(page).toHaveURL(/q=SKU\+teste.*status=archived/)
  await page.getByRole("button", { name: "Próxima", exact: true }).click()
  await expect(page).toHaveURL(/offset=25/)
  await page.reload()
  await expect(search).toHaveValue("SKU teste")
  await expect(page.getByRole("combobox", { name: "Situação", exact: true })).toHaveValue("archived")
  await expect(page.getByText("Página 2", { exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.getByText("Página 1", { exact: true })).toBeVisible()
  await expect(search).toHaveValue("SKU teste")
})

test("preferências mantém conteúdo acessível nos breakpoints e no tema escuro", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("erp-theme", "dark"))
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" })
  await page.goto("/preferencias/empresa")
  await expect(page.getByText("Consulta da empresa indisponível", { exact: true })).toBeVisible()
  await expect(page.locator("html")).toHaveClass(/dark/)
  for (const width of [320, 390, 768, 1280, 1599, 1600, 1749]) {
    await page.setViewportSize({ width, height: 950 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await expect(page.getByRole("heading", { name: "Empresa", exact: true })).toBeVisible()
    if (width === 390 || width === 1749) await page.screenshot({ path: testInfo.outputPath(`preferencias-${width}.png`), fullPage: true })
  }
})

test("painel mobile fecha após navegar para uma configuração", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/preferencias/empresa")
  await page.getByRole("button", { name: "Preferências", exact: true }).click()
  await page.getByRole("dialog").getByRole("link", { name: "Exportação de dados", exact: true }).click()
  await expect(page).toHaveURL(/\/preferencias\/dados\/exportacao$/)
  await expect(page.getByRole("dialog")).toHaveCount(0)
})

test("busca distingue módulos, configurações e operações financeiras", async ({ page }) => {
  await page.goto("/")
  for (const [query, label, path] of [
    ["Financeiro", "Financeiro", "/financeiro"],
    ["Configurações financeiras", "Configurações financeiras", "/preferencias/financeiro"],
    ["Contas a pagar", "Contas a pagar", "/financeiro/contas-pagar"],
    ["Contas a receber", "Contas a receber", "/financeiro/contas-receber"],
    ["Fiscal", "Fiscal", "/fiscal"],
    ["Monitor fiscal", "Monitor fiscal", "/fiscal/monitor"],
  ]) {
    await page.getByRole("button", { name: /Pesquisar/ }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("combobox").fill(query)
    await dialog.getByRole("option").filter({ has: page.getByText(label, { exact: true }) }).first().click()
    await expect(page).toHaveURL(origin + path)
    await expect(dialog).toHaveCount(0)
  }
})

test("importação demonstrativa informa que não produz relatório", async ({ page }) => {
  await page.goto("/vendas/importacao")
  await page.getByRole("button", { name: /Pesquisar/ }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.keyboard.press("Escape")
  await page.getByLabel("Arquivo CSV ou XLSX").setInputFiles({ name: "fixture.csv", mimeType: "text/csv", buffer: Buffer.from("numero_pedido,documento_cliente\n") })
  await expect(page.getByRole("button", { name: "Continuar", exact: true })).toBeEnabled()
  for (let step = 0; step < 3; step++) await page.getByRole("button", { name: "Continuar", exact: true }).click()
  await expect(page.getByRole("button", { name: "Baixar relatório demonstrativo", exact: true })).toBeDisabled()
  await expect(page.getByText("Download indisponível: esta simulação não gera um relatório do arquivo selecionado.", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Revisão concluída", exact: true })).toBeDisabled()
})

test("link copiado restaura consulta e limpar filtros reinicia paginação", async ({ page, context }) => {
  await page.goto("/cadastros/produtos?q=SKU+teste&status=archived&offset=25")
  await expect(page.getByRole("heading", { name: "Produtos", exact: true })).toBeVisible({ timeout: 15000 })
  await expect(page.getByText("Página 2", { exact: true })).toBeVisible()
  const copied = await context.newPage()
  await copied.goto(page.url())
  await expect(copied.getByRole("textbox", { name: "Buscar nome ou SKU", exact: true })).toHaveValue("SKU teste")
  await expect(copied.getByRole("combobox", { name: "Situação", exact: true })).toHaveValue("archived")
  await expect(copied.getByText("Página 2", { exact: true })).toBeVisible()
  await copied.close()
  await page.getByRole("textbox", { name: "Buscar nome ou SKU", exact: true }).fill("")
  await page.getByRole("combobox", { name: "Situação", exact: true }).selectOption("")
  await page.locator("main").getByRole("button", { name: "Buscar", exact: true }).click()
  await expect(page).toHaveURL(origin + "/cadastros/produtos")
  await expect(page.getByText("Página 1", { exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.getByText("Página 2", { exact: true })).toBeVisible()
  await page.goForward()
  await expect(page.getByText("Página 1", { exact: true })).toBeVisible()
})

test("consulta limita parâmetros inválidos e impede ultrapassar limite da API", async ({ page }) => {
  const requests: URL[] = []
  await page.route("**/api/erp/products?*", route => {
    requests.push(new URL(route.request().url()))
    return route.fulfill({ json: { tenantId: "11111111-1111-4111-8111-111111111111", canEdit: true, data: [], total: 100100 } })
  })
  await page.goto("/cadastros/produtos?q=" + "a".repeat(170) + "&status=invalid&offset=-25")
  await expect(page.getByText("Página 1", { exact: true })).toBeVisible()
  expect(requests.at(-1)?.searchParams.get("q")).toHaveLength(160)
  expect(requests.at(-1)?.searchParams.get("status")).toBeNull()
  expect(requests.at(-1)?.searchParams.get("offset")).toBe("0")
  await page.goto("/cadastros/produtos?offset=100000")
  await expect(page.getByText("Página 4001", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Próxima", exact: true })).toBeDisabled()
  await expect(page.getByText("Refine a busca para acessar outros resultados.", { exact: true })).toBeVisible()
  expect(requests.at(-1)?.searchParams.get("offset")).toBe("100000")
  await page.goto("/cadastros/produtos?offset=100025")
  await expect(page.getByText("Página 1", { exact: true })).toBeVisible()
  expect(requests.at(-1)?.searchParams.get("offset")).toBe("0")
})
