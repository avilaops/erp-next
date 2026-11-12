import { expect, test } from "@playwright/test"
import { createServer } from "node:http"
import { origin } from "../playwright.danfe.config"
import { installFrontendFixture, tenant } from "./helpers/frontend-fixture"

const issuer = "http://127.0.0.1:33120"
const logouts: URL[] = []
const auth = createServer((request, response) => {
  const url = new URL(request.url || "/", issuer)
  if (url.pathname === "/.well-known/openid-configuration") {
    response.writeHead(200, { "Content-Type": "application/json" })
    response.end(JSON.stringify({ issuer, code_challenge_methods_supported: ["S256"], authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, end_session_endpoint: `${issuer}/end-session` }))
  } else if (url.pathname === "/end-session") {
    logouts.push(url)
    response.writeHead(303, { Location: `${origin}/api/auth/logout/central/callback` })
    response.end()
  } else {
    response.writeHead(404)
    response.end()
  }
})

test.beforeAll(async () => {
  await new Promise<void>((resolve, reject) => { auth.once("error", reject); auth.listen(33120, "127.0.0.1", resolve) })
})
test.afterAll(async () => { await new Promise<void>(resolve => auth.close(() => resolve())) })
test.beforeEach(async ({ context, page }) => {
  logouts.length = 0
  await installFrontendFixture(context)
  await context.route("**/api/erp/products**", route => route.fulfill({ json: { tenantId: tenant, canEdit: true, data: [], total: 0 } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/cadastros/produtos/novo")
  await expect(page.getByRole("button", { name: "Salvar produto", exact: true })).toBeEnabled()
  await page.getByRole("textbox", { name: "Nome do produto", exact: true }).fill("Edição pendente")
  await page.evaluate(() => sessionStorage.setItem("erp:party-draft:v1:previous-session:new", JSON.stringify({ taxId: "synthetic-personal-data" })))
})
test.afterEach(async ({ context }) => { await context.unrouteAll({ behavior: "ignoreErrors" }) })

test("cancelar a saída preserva a edição e não envia POST", async ({ page, context }) => {
  const posts: string[] = []
  page.on("request", request => { if (request.url() === `${origin}/api/auth/logout` && request.method() === "POST") posts.push(request.url()) })
  page.once("dialog", async dialog => { expect(dialog.type()).toBe("confirm"); await dialog.dismiss() })
  await page.getByRole("button", { name: "Sair", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Nome do produto", exact: true })).toHaveValue("Edição pendente")
  await expect(page.getByRole("button", { name: "Sair", exact: true })).toBeEnabled()
  expect(posts).toEqual([])
  expect((await context.cookies(origin)).some(cookie => cookie.name === "erp_session")).toBe(true)
  expect(await page.evaluate(() => sessionStorage.getItem("erp:party-draft:v1:previous-session:new"))).not.toBeNull()
})

test("confirmar a saída pede confirmação uma vez e conclui o logout central", async ({ page, context }) => {
  const dialogs: string[] = []
  page.on("dialog", async dialog => { dialogs.push(dialog.type()); await dialog.accept() })
  const request = page.waitForRequest(request => request.url() === `${origin}/api/auth/logout` && request.method() === "POST")
  await page.getByRole("button", { name: "Sair", exact: true }).click()
  expect((await request).headers().origin).toBe(origin)
  await expect(page).toHaveURL(`${origin}/entrar`)
  expect(dialogs).toEqual(["confirm"])
  expect(logouts).toHaveLength(1)
  expect(logouts[0].searchParams.get("client_id")).toBe("browser-fixture-client")
  expect(logouts[0].searchParams.get("post_logout_redirect_uri")).toBe(`${origin}/api/auth/logout/central/callback`)
  expect((await context.cookies(origin)).filter(cookie => cookie.name.startsWith("erp_"))).toEqual([])
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("erp:party-draft:")))).toEqual([])
})

test("falha no POST mantém a proteção da edição e permite tentar novamente", async ({ page, context }) => {
  await page.route(`${origin}/api/auth/logout`, route => route.fulfill({ status: 403, json: { title: "Origem não autorizada" } }))
  page.once("dialog", dialog => dialog.accept())
  await page.getByRole("button", { name: "Sair", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "A saída foi recusada" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Sair", exact: true })).toBeEnabled()
  await page.getByRole("button", { name: "Abrir menu", exact: true }).click()
  const dialog = page.waitForEvent("dialog")
  const navigation = page.getByRole("dialog").getByRole("link", { name: "Visão geral", exact: true }).click()
  await (await dialog).dismiss()
  await navigation
  await page.getByRole("dialog").getByRole("button", { name: "Fechar menu", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Nome do produto", exact: true })).toHaveValue("Edição pendente")
  expect((await context.cookies(origin)).some(cookie => cookie.name === "erp_session")).toBe(true)
})
