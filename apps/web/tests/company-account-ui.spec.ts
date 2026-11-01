import { test, expect } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { origin, secret } from "../playwright.danfe.config"
import { accountHref, accountSections } from "../src/features/company/account/account-navigation"
import type { Account, Subscription } from "../src/features/company/account/account-types"
import { companyFields } from "../src/features/company/company-types"

const tenant = "11111111-1111-4111-8111-111111111111"
const id = "22222222-2222-4222-8222-222222222222"
let account: Account
let calls: { action: string; body: Record<string, unknown>; tenant?: string }[]
let fail: boolean
test.beforeEach(async ({ context }) => {
  fail = false; calls = []
  account = { tenantId: tenant, canEdit: true, providerConfigured: true, activeUsers: 3, productPhotoBytes: 1800000, subscriptions: [], plans: [
    { id: "cobalto", name: "Cobalto", monthlyCents: 6000, dataMegabytes: 60, users: 5, importedOrders: 200, customQuote: false },
    { id: "titanio-1", name: "Titânio Faixa 1", monthlyCents: 12000, dataMegabytes: 120, users: 50, importedOrders: null, customQuote: false },
    { id: "titanio-2", name: "Titânio Faixa 2", monthlyCents: 20000, dataMegabytes: 360, users: 50, importedOrders: null, customQuote: false },
    { id: "titanio-3", name: "Titânio Faixa 3", monthlyCents: 45000, dataMegabytes: 1200, users: 50, importedOrders: null, customQuote: false },
    { id: "diamante", name: "Diamante", monthlyCents: 65000, dataMegabytes: 1800, users: 100, importedOrders: null, customQuote: false },
    { id: "elite", name: "Elite", monthlyCents: 125000, dataMegabytes: 5000, users: null, importedOrders: null, customQuote: true },
  ] }
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "company-account-fixture", tenantId: tenant, expiresAt: Date.now() + 3600000 })), cipher.final()])
  await context.addCookies([{ name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" }])
  await context.route("**/api/erp/company-account**", async route => {
    const request = route.request(), url = new URL(request.url()), action = url.pathname.split("/").at(-1)!
    if (fail) return route.fulfill({ status: 503, json: { title: "Mercado Pago indisponível" } })
    if (action === "invoices") return route.fulfill({ json: { data: [{ id: 1, description: "Assinatura mensal", amount: "60.00", currency: "BRL", dueDate: "2026-11-10T12:00:00Z", status: "processed", paymentStatus: "approved" }], total: 1 } })
    if (request.method() === "GET") return route.fulfill({ json: account })
    const body = request.postDataJSON()
    calls.push({ action, body, tenant: request.headers()["x-tenant-id"] })
    const subscription: Subscription = { id, planId: body.planId || "cobalto", status: action === "cancel" ? "cancelled" : action === "checkout" ? "pending" : "authorized", details: { checkoutUrl: "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=fixture", checkedAt: "2026-11-01T12:00:00Z" } }
    account.subscriptions = [subscription]
    return route.fulfill({ json: subscription })
  })
})

test("navegação das telas de conta e temas sem overflow", async ({ page }, testInfo) => {
  test.setTimeout(180000)
  for (const theme of ["light", "dark"]) {
    await page.goto(accountHref("plano"))
    await page.evaluate(value => localStorage.setItem("erp-theme", value), theme)
    for (const section of ["pagamento", "extrato", "armazenamento", "importacoes", "plano", "cancelamento", "horarios"] as const) {
      await page.setViewportSize({ width: 1600, height: 1000 })
      await page.goto(accountHref(section))
      await expect(page.getByRole("heading", { name: accountSections[section], exact: true })).toBeVisible()
      await expect(page.getByRole("navigation", { name: "Conta da empresa" }).getByRole("link", { name: accountSections[section], exact: true })).toHaveAttribute("aria-current", "page")
      for (const width of [390, 1600]) {
        await page.setViewportSize({ width, height: 1000 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.screenshot({ path: testInfo.outputPath(`account-${section}-${theme}-${width}.png`), fullPage: true })
      }
    }
  }
  expect(calls).toEqual([])
})

test("contratação confirma preço e não ativa plano localmente", async ({ page }) => {
  await page.goto(accountHref("plano"))
  const plan = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Cobalto", exact: true }) })
  await expect(plan).toContainText("60,00")
  await plan.getByRole("button", { name: "Escolher plano" }).click()
  expect(calls).toEqual([])
  await page.getByLabel("E-mail do pagador").fill("payer@example.test")
  await page.getByRole("button", { name: "Criar checkout no Mercado Pago" }).click()
  await expect(page.getByRole("status").filter({ hasText: "Checkout criado" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Continuar no Mercado Pago" })).toHaveAttribute("href", /www\.mercadopago\.com\.br\/subscriptions\/checkout/)
  expect(calls).toEqual([{ action: "checkout", body: { planId: "cobalto", payerEmail: "payer@example.test" }, tenant }])
  await expect(page.getByRole("article").filter({ hasText: "Titânio Faixa 1" }).getByRole("button")).toBeDisabled()
})

test("alteração de plano confirma valor da mesma assinatura", async ({ page }) => {
  account.subscriptions = [{ id, planId: "cobalto", status: "authorized", details: {} }]
  await page.goto(accountHref("plano"))
  await page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Titânio Faixa 1", exact: true }) }).getByRole("button").click()
  await expect(page.getByRole("form", { name: "Confirmar plano" })).toContainText("120,00")
  expect(calls).toEqual([])
  await page.getByRole("button", { name: "Confirmar alteração de valor" }).click()
  await expect(page.getByRole("status").filter({ hasText: "Valor recorrente atualizado" })).toBeVisible()
  expect(calls[0]).toEqual({ action: "change-plan", body: { subscriptionId: id, planId: "titanio-1" }, tenant })
})

test("cancelamento exige confirmação e preserva dados da empresa", async ({ page }) => {
  account.subscriptions = [{ id, planId: "cobalto", status: "authorized", details: {} }]
  await page.goto(accountHref("cancelamento"))
  await page.getByRole("button", { name: "Continuar para confirmação" }).click()
  await expect(page.getByRole("button", { name: "Cancelar assinatura no Mercado Pago" })).toBeDisabled()
  await page.getByLabel("Digite CANCELAR para confirmar").fill("CANCELAR")
  await page.getByRole("button", { name: "Cancelar assinatura no Mercado Pago" }).click()
  await expect(page.getByRole("heading", { name: "Assinatura cancelada", exact: true })).toBeVisible()
  expect(calls).toEqual([{ action: "cancel", body: { subscriptionId: id, confirmation: "CANCELAR" }, tenant }])
})

test("leitor e ambiente sem provedor não contratam", async ({ page }) => {
  account.canEdit = false
  await page.goto(accountHref("plano"))
  await expect(page.getByRole("button", { name: "Escolher plano" }).first()).toBeDisabled()
  account.canEdit = true; account.providerConfigured = false
  await page.reload()
  await expect(page.getByText("A conexão de assinaturas", { exact: false })).toBeVisible()
  await expect(page.getByRole("button", { name: "Escolher plano" }).first()).toBeDisabled()
  expect(calls).toEqual([])
})

test("extrato consultado exporta a página e distingue erro de vazio", async ({ page }) => {
  account.subscriptions = [{ id, planId: "cobalto", status: "authorized", details: {} }]
  await page.goto(accountHref("extrato"))
  await expect(page.getByRole("cell", { name: "Assinatura mensal", exact: true })).toBeVisible()
  await expect(page.getByRole("cell", { name: "Pago", exact: true })).toBeVisible()
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Exportar esta página" }).click()
  expect((await download).suggestedFilename()).toBe("extrato-assinatura-pagina.csv")
  await expect(page.getByRole("button", { name: "Próxima", exact: true })).toBeDisabled()
  fail = true
  await page.reload()
  await expect(page.locator("main").getByRole("alert")).toContainText("Mercado Pago indisponível")
  await expect(page.getByText("Nenhuma assinatura cadastrada", { exact: true })).toHaveCount(0)
})

test("sócio persiste sem substituir contato da empresa", async ({ page }) => {
  let data = { ...Object.fromEntries(companyFields.map(field => [field, ""])), legalName: "Empresa de teste", contactName: "Contato comercial", mobile: "1133334444", partnerName: "", partnerMobile: "", segments: ["Comércio"], substituteRegistrations: [] }
  let revision = 1
  await page.route("**/api/erp/company", async route => {
    if (route.request().method() === "PUT") { expect(route.request().headers()["if-match"]).toBe('"1"'); expect(route.request().headers()["x-tenant-id"]).toBe(tenant); data = route.request().postDataJSON(); revision++ }
    return route.fulfill({ headers: { etag: `"${revision}"` }, json: { data, tenantId: tenant, revision, canEdit: true } })
  })
  await page.goto(accountHref("socio"))
  await page.getByLabel("Nome completo", { exact: true }).fill("Sócia de teste")
  await page.getByLabel("Celular do sócio").fill("11999999999")
  page.once("dialog", dialog => dialog.dismiss())
  await page.getByRole("navigation", { name: "Conta da empresa" }).getByRole("link", { name: "Formas de pagamento" }).click()
  await expect(page).toHaveURL(/conta\/socio$/)
  await page.getByRole("button", { name: "Salvar dados do sócio" }).click()
  await expect(page.getByText("Cadastro salvo no servidor.", { exact: true })).toBeVisible()
  expect(data.contactName).toBe("Contato comercial"); expect(data.mobile).toBe("1133334444")
  expect(data.partnerName).toBe("Sócia de teste")
  await page.reload()
  await expect(page.getByLabel("Nome completo", { exact: true })).toHaveValue("Sócia de teste")
})

test("BFF rejeita outra origem, empresa trocada e filtros não permitidos", async ({ context, playwright }) => {
  const foreignOrigin = await context.request.post("/api/erp/company-account/checkout", { headers: { Origin: "https://foreign.example.test", "X-Tenant-Id": tenant }, data: { planId: "cobalto", payerEmail: "payer@example.test" } })
  expect(foreignOrigin.status()).toBe(403)
  const foreignTenant = await context.request.post("/api/erp/company-account/cancel", { headers: { Origin: origin, "X-Tenant-Id": id }, data: { subscriptionId: id, confirmation: "CANCELAR" } })
  expect(foreignTenant.status()).toBe(409)
  const invalidFilter = await context.request.get("/api/erp/company-account/invoices?providerId=foreign")
  expect(invalidFilter.status()).toBe(400)
  const noSession = await playwright.request.newContext({ baseURL: origin })
  expect((await noSession.get("/api/erp/company-account")).status()).toBe(401)
  await noSession.dispose()
})

test("auditoria descreve ações em português e reserva códigos aos detalhes", async ({ page }, testInfo) => {
  const events = [
    { id: "1", occurredAt: "2026-10-31T23:33:45Z", actor: "Pessoa de teste", action: "role.updated", entityType: "role" },
    { id: "2", occurredAt: "2026-10-31T22:56:04Z", actor: "Pessoa de teste", action: "contract_template.published", entityType: "contract_template_version" },
    { id: "3", occurredAt: "2026-10-31T22:50:00Z", actor: null, action: "contract.reconciled", entityType: "commercial_contract" },
    { id: "4", occurredAt: "2026-10-31T22:40:00Z", actor: null, action: "new.unrecognized.action", entityType: "unknown_entity" },
  ]
  await page.route("**/api/erp/audit?*", route => route.fulfill({ json: { tenantId: tenant, data: events, nextCursor: null } }))
  await page.goto("/preferencias/seguranca")
  await expect(page.getByRole("heading", { name: "Histórico de atividades" })).toBeVisible()
  const first = page.locator("main ol li").first()
  await expect(first).toContainText("Perfil de acesso alterado")
  await expect(first).toContainText("Realizado por Pessoa de teste")
  await expect(first.getByText("role.updated", { exact: true })).toBeHidden()
  await expect(page.locator("main ol li").nth(1)).toContainText("Modelo de contrato publicado")
  await expect(page.locator("main ol li").nth(2)).toContainText("Atualização automática do sistema")
  await expect(page.locator("main ol li").last()).toContainText("Atividade registrada")
  await expect(page.getByLabel("Código exato da ação")).toHaveCount(0)
  await first.getByText("Informações para o suporte", { exact: true }).click()
  await expect(first.getByText("role.updated", { exact: true })).toBeVisible()
  await first.getByText("Informações para o suporte", { exact: true }).click()
  for (const theme of ["light", "dark"]) {
    await page.evaluate(value => localStorage.setItem("erp-theme", value), theme)
    await page.reload()
    await expect(first).toContainText("Perfil de acesso alterado")
    for (const width of [390, 915, 1600]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: testInfo.outputPath(`audit-${theme}-${width}.png`), fullPage: true })
    }
  }
})

test("filtros amigáveis preservam os códigos enviados à consulta de auditoria", async ({ page }) => {
  const queries: URLSearchParams[] = []
  await page.route("**/api/erp/audit?*", route => {
    queries.push(new URL(route.request().url()).searchParams)
    return route.fulfill({ json: { tenantId: tenant, data: [], nextCursor: null } })
  })
  await page.goto("/preferencias/seguranca")
  await expect(page.getByText("Nenhuma atividade encontrada para estes filtros.")).toBeVisible()
  await page.getByRole("combobox", { name: "Atividade", exact: true }).selectOption({ label: "Dados da empresa alterados" })
  await page.getByRole("combobox", { name: "Área do sistema", exact: true }).selectOption({ label: "Empresa" })
  await page.getByLabel("Responsável", { exact: true }).fill("Pessoa de teste")
  await page.getByRole("button", { name: "Aplicar filtros", exact: true }).click()
  await expect.poll(() => queries.at(-1)?.get("action")).toBe("company.updated")
  expect(queries.at(-1)?.get("entity")).toBe("company")
  expect(queries.at(-1)?.get("q")).toBe("Pessoa de teste")
  await page.getByLabel("Data inicial", { exact: true }).fill("2026-11-02")
  await page.getByLabel("Data final", { exact: true }).fill("2026-11-01")
  const before = queries.length
  await page.getByRole("button", { name: "Aplicar filtros", exact: true }).click()
  await expect(page.locator("main").getByRole("alert")).toContainText("Data final deve ser igual ou posterior")
  expect(queries.length).toBe(before)
  await page.getByRole("button", { name: "Limpar filtros", exact: true }).click()
  await expect.poll(() => queries.at(-1)?.toString()).toBe("")
})
