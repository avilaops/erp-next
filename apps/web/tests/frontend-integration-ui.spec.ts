import { expect, test } from "@playwright/test"
import axe from "axe-core"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"
import { blankDraft, blankItem } from "../src/features/fiscal/nfe-draft-model"

test.beforeEach(async ({ context }) => installFrontendFixture(context))

const ready = { tenantId: tenant, profileConfigured: true, certificateVerified: false, canTransmit: false, productionEnabled: false, blockers: ["a1_certificate_missing_expired_or_unavailable"] }
const permissions = ["fiscal.nfe.read", "fiscal.nfe.manage", "catalog.parties.read", "catalog.products.read"]

test("fiscal integrado mantém listagem e preparação do pedido fora das prévias", async ({ page }, info) => {
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions } }))
  await page.route("**/api/erp/fiscal/readiness", route => route.fulfill({ json: ready }))
  await page.route("**/api/erp/fiscal/nfe?*", route => route.fulfill({ json: { tenantId: tenant, data: [], nextCursor: null } }))
  const input = { ...blankDraft(), recipient: { taxId: "52998224725", legalName: "Cliente da fixture", state: "SP", municipalityCode: "3550308", postalCode: "01001000", street: "Rua de teste", number: "1", district: "Centro" }, items: [{ ...blankItem(), code: "SKU-1", description: "Produto da fixture", unit: "UN", ncm: "00000000", quantity: "3.0000", unitPrice: "0.3333333333", grossTotal: "1.00" }], productsTotal: "1.00" }
  await page.route("**/api/erp/fiscal/order-preparations/" + record, route => route.fulfill({ json: { tenantId: tenant, orderId: record, orderRevision: 2, customerId: record, recipient: input.recipient, items: input.items, productsTotal: input.productsTotal } }))
  await page.goto("/fiscal")
  const fiscalLink = page.locator('main a[href="/fiscal/notas-saida"]')
  await expect(fiscalLink).toContainText("Abrir funcionalidade", { timeout: process.env.ERP_BROWSER_DEV === "1" ? 30_000 : 5_000 })
  await fiscalLink.click()
  await expect(page).toHaveTitle("NF-e de saída · ERP Next · Ávila Ops")
  await expect(page.getByText("Nenhum rascunho cadastrado nesta empresa.", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Prévia de interface", exact: true })).toHaveCount(0)
  await page.goto("/fiscal/notas-saida/nova?pedido=" + record)
  await expect(page).toHaveTitle("Nova NF-e de saída · ERP Next · Ávila Ops")
  await expect(page.getByLabel("Nome ou razão social", { exact: true })).toHaveValue("Cliente da fixture")
  await expect(page.getByLabel("Quantidade", { exact: true })).toHaveValue("3.0000")
  await expect(page.getByLabel("Quantidade", { exact: true })).toHaveAttribute("readonly", "")
  await expect(page.getByLabel("Natureza da operação", { exact: true })).toBeEditable()
  await expect(page.getByRole("heading", { name: "Prévia de interface", exact: true })).toHaveCount(0)
  for (const width of [390, 1749]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath("nfe-pedido-" + width + ".png"), fullPage: true })
  }
})

test("certificado preserva gestão A1, revisão, limpeza de senha e recuperação 401", async ({ page }) => {
  const snapshot = { tenantId: tenant, revision: 3, canEdit: true, uploadAvailable: true, companyTaxId: "00000000000000", status: "not_configured", data: null }
  let status = 200
  let sent: { revision?: string; tenant?: string; body?: unknown } | undefined
  await page.route("**/api/erp/fiscal/certificate", route => {
    if (route.request().method() === "GET") return route.fulfill({ status, headers: { ETag: '"3"' }, json: status === 200 ? snapshot : { title: "Sessão expirada" } })
    sent = { revision: route.request().headers()["if-match"], tenant: route.request().headers()["x-tenant-id"], body: route.request().postDataJSON() }
    return route.fulfill({ status: 412, json: { title: "Outra pessoa alterou o certificado" } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/preferencias/certificado-digital")
  const upload = page.getByLabel("Arquivo do certificado A1", { exact: true })
  const password = page.getByLabel("Senha do certificado", { exact: true })
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: "fixture-invalida.pfx", mimeType: "application/x-pkcs12", buffer: Buffer.from("synthetic-not-a-certificate") })
  await password.fill("fixture-not-a-secret")
  await page.getByRole("button", { name: "Conectar certificado", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Outra pessoa" })).toBeVisible()
  await expect(password).toHaveValue("")
  await expect(upload).toBeDisabled()
  expect(sent).toMatchObject({ revision: '"3"', tenant, body: { password: "fixture-not-a-secret" } })
  await expect(page.getByRole("status").filter({ hasText: "armazenado" })).toHaveCount(0)
  status = 401
  await page.getByRole("button", { name: "Recarregar dados do servidor", exact: true }).click()
  await expect(page.locator("main").getByRole("link", { name: "Entrar com Ávila Ops", exact: true })).toHaveAttribute("href", "/entrar?returnTo=%2Fpreferencias%2Fcertificado-digital")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("áreas reconciliadas têm rótulos e contraste verificáveis em claro e escuro", async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem("erp-theme", "system"))
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme as "light" | "dark", reducedMotion: "reduce" })
    for (const route of ["/preferencias/empresa", "/preferencias/certificado-digital", "/fiscal/notas-saida"]) {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(route)
      await expect(page.locator("h1")).toBeVisible()
      await expect.poll(() => page.locator("html").evaluate(element => element.classList.contains("dark"))).toBe(theme === "dark")
      if (route === "/fiscal/notas-saida") await expect(page.getByRole("button", { name: "Atualizar lista", exact: true })).toBeEnabled()
      await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))))
      await page.addScriptTag({ content: axe.source })
      const result = await page.evaluate(async () => {
        const scanner = (window as unknown as { axe: typeof axe }).axe
        return scanner.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })
      })
      await info.attach(route.replaceAll("/", "-") + "-" + theme, { body: JSON.stringify({ violations: result.violations, incomplete: result.incomplete }), contentType: "application/json" })
      await page.screenshot({ path: info.outputPath(route.replaceAll("/", "-") + "-" + theme + ".png"), fullPage: true })
      expect(result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) }))).toEqual([])
    }
  }
})
