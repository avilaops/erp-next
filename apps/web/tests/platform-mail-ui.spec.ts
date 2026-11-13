import { test, expect } from "@playwright/test"
import { createServer } from "node:http"
import { installFrontendFixture } from "./helpers/frontend-fixture"

const data = { enabled: true, name: "Servidor central", host: "smtp.example.test", port: 587, security: "starttls", username: "mail-user", fromName: "Ludus", fromAddress: "vendas@example.test", passwordSet: true }
const path = "/api/erp/platform/mail-settings"
test.beforeEach(async ({ context, baseURL }) => installFrontendFixture(context, baseURL))

test("configuração central normaliza host misto, limpa senha e exige senha ao migrar do ambiente", async ({ page }) => {
  let writes = 0, saved = false, currentData = data
  await page.route(`**${path}`, route => {
    if (route.request().method() === "GET") return route.fulfill({ headers: { ETag: saved ? '"1"' : '"0"' }, json: { revision: saved ? 1 : 0, source: saved ? "platform" : "environment", canManage: true, encryptionReady: true, data: currentData } })
    writes++
    expect(route.request().headers()["if-match"]).toBe('"0"')
    const body = route.request().postDataJSON()
    expect(body.password).toBe("test-only-password")
    expect(body.host).toBe("smtp.example.test")
    expect(body).not.toHaveProperty("passwordSet")
    saved = true
    currentData = { ...data, name: body.name, host: body.host.toLowerCase() }
    return route.fulfill({ headers: { ETag: '"1"' }, json: { revision: 1, source: "platform", canManage: true, encryptionReady: true, data: currentData } })
  })
  await page.goto("/preferencias/sistema/email")
  await expect(page.getByRole("heading", { name: "E-mail da plataforma", exact: true })).toBeVisible()
  await expect(page.getByLabel("Senha SMTP", { exact: true })).toHaveValue("")
  await page.getByLabel("Nome do servidor", { exact: true }).fill("Correio central")
  await page.getByLabel("Servidor SMTP", { exact: true }).fill(" SMTP.Example.Test ")
  await page.getByRole("button", { name: "Salvar SMTP", exact: true }).click()
  expect(writes).toBe(0)
  await page.getByLabel("Senha SMTP", { exact: true }).fill("test-only-password")
  await page.getByRole("button", { name: "Salvar SMTP", exact: true }).click()
  await expect(page.getByText("Configuração SMTP salva.", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Senha SMTP", { exact: true })).toHaveValue("")
  await expect(page.getByLabel("Servidor SMTP", { exact: true })).toHaveValue("smtp.example.test")
  await expect(page.getByLabel("Servidor SMTP", { exact: true })).toBeEnabled()
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0)
  expect(writes).toBe(1)
  await expect(page.getByLabel("Nome do servidor", { exact: true })).toHaveValue("Correio central")
  expect(await page.evaluate(() => Object.values(localStorage).some(value => value.includes("test-only-password")))).toBe(false)
})

test("administrador de empresa não recebe o formulário SMTP global", async ({ page }) => {
  await page.route(`**${path}`, route => route.fulfill({ status: 403, json: { title: "Somente administradores da plataforma podem configurar e-mail." } }))
  await page.goto("/preferencias/sistema/email")
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible()
  await expect(page.getByLabel("Senha SMTP", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Salvar SMTP", exact: true })).toHaveCount(0)
})

test("alterar destino exige nova senha e falha de revisão preserva os campos", async ({ page }) => {
  let writes = 0
  await page.route(`**${path}`, route => {
    if (route.request().method() === "GET") return route.fulfill({ headers: { ETag: '"4"' }, json: { revision: 4, source: "platform", canManage: true, encryptionReady: true, data } })
    writes++
    return route.fulfill({ status: 412, json: { title: "A configuração foi alterada. Recarregue antes de salvar." } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/preferencias/sistema/email")
  await page.getByLabel("Servidor SMTP", { exact: true }).fill("novo.example.test")
  await page.getByRole("button", { name: "Salvar SMTP", exact: true }).click()
  expect(writes).toBe(0)
  await page.getByLabel("Senha SMTP", { exact: true }).fill("replacement-test-only")
  await page.getByRole("button", { name: "Salvar SMTP", exact: true }).click()
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Recarregue")
  await expect(page.getByLabel("Servidor SMTP", { exact: true })).toHaveValue("novo.example.test")
  await expect(page.getByRole("button", { name: "Salvar SMTP", exact: true })).toBeDisabled()
  expect(writes).toBe(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("BFF SMTP usa identidade global, revisão zero e origem autorizada", async ({ context, baseURL }) => {
  const requests: { method?: string; revision?: string; token?: string }[] = []
  const server = createServer((request, response) => {
    request.resume()
    requests.push({ method: request.method, revision: request.headers["if-match"] as string | undefined, token: request.headers.authorization })
    expect(request.url).toBe("/api/v1/platform/mail-settings")
    response.writeHead(200, { "Content-Type": "application/json", ETag: '"0"' })
    response.end(JSON.stringify({ revision: 0, source: "unconfigured", canManage: true, encryptionReady: true, data }))
  })
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(33191, "127.0.0.1", resolve) })
  try {
    expect((await context.request.get(path)).status()).toBe(200)
    const response = await context.request.put(path, { headers: { Origin: baseURL!, "If-Match": '"0"' }, data: { enabled: false } })
    expect(response.status()).toBe(200)
    expect(response.headers().etag).toBe('"0"')
    expect(requests[1]).toEqual({ method: "PUT", revision: '"0"', token: "Bearer frontend-integration-fixture" })
    expect((await context.request.put(path, { headers: { Origin: "https://other.example.test", "If-Match": '"0"' }, data: {} })).status()).toBe(403)
    expect((await context.request.get(`${path}?unexpected=1`)).status()).toBe(400)
    expect(requests).toHaveLength(2)
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})
