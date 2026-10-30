import { expect, test } from "@playwright/test"
import { readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { installFrontendFixture, record } from "./helpers/frontend-fixture"

function pages(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? pages(path.join(root, entry.name)) : entry.name === "page.tsx" ? [path.join(root, entry.name)] : [])
}

test("inventário completo: capturas desktop/mobile e estados observados", async ({ page, context }, info) => {
  await installFrontendFixture(context)
  const root = path.resolve("src/app")
  const routes = pages(root).map(file => "/" + path.relative(root, path.dirname(file)).split(path.sep).join("/"))
  const rows: object[] = []
  const unexpected: object[] = []
  let errors: string[] = []
  let diagnostics: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  page.on("console", message => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) diagnostics.push(message.text()) })
  for (const [index, pattern] of routes.entries()) {
    const route = pattern.replace("[kind]", "vendas").replace("[provider]", "mercado-livre").replaceAll("[id]", record)
    errors = []
    diagnostics = []
    let navigationError = ""
    try {
      await page.goto(route)
      await page.locator("h1, main [role=alert]").first().waitFor({ timeout: 30000 })
      await expect.poll(() => page.locator('[role="status"]').allTextContents().then(values => values.some(value => /Carregando|Preparando ERP|Consultando/.test(value))), { timeout: 15000 }).toBe(false)
    } catch (error) {
      navigationError = error instanceof Error ? error.message : String(error)
    }
    for (const width of [390, 1749]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 950 })
      await page.screenshot({ path: info.outputPath(String(index).padStart(3, "0") + "-" + width + ".png"), fullPage: true, caret: "initial" })
      const state = await page.evaluate(() => ({
        url: location.pathname, title: document.title, width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        headings: [...document.querySelectorAll("h1")].map(item => item.textContent),
        messages: [...document.querySelectorAll('[role="alert"], [role="status"]')].map(item => item.textContent?.slice(0, 250)),
      }))
      const row = { pattern, ...state, navigationError, errors: [...errors], diagnostics: [...diagnostics] }
      rows.push(row)
      if (state.scrollWidth > width || state.url === "/entrar" && pattern !== "/entrar" || !state.headings.length || navigationError || errors.length || diagnostics.length) unexpected.push(row)
    }
    writeFileSync(info.outputPath("coverage.json"), JSON.stringify({ scope: "Local UI; synthetic session; unavailable API; no transactional proof", rows, unexpected }, null, 2))
    console.log("AUDIT " + (index + 1) + "/" + routes.length + " " + pattern)
  }
  expect(routes).toHaveLength(178)
  expect(unexpected, "Consulte coverage.json e capturas").toEqual([])
})
