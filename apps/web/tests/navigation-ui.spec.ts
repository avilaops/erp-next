import { expect, test } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { origin, secret } from "../playwright.danfe.config"

test.beforeEach(async ({ context }) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "navigation-fixture-token", tenantId: "11111111-1111-4111-8111-111111111111", expiresAt: Date.now() + 3600_000 })), cipher.final()])
  await context.addCookies([{ name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" }])
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
