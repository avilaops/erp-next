import { expect, test, type BrowserContext } from "@playwright/test"
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto"

const origin = process.env.ERP_TEST_WEB_ORIGIN || "http://127.0.0.1:3202"
const tenant = "11111111-1111-4111-8111-111111111111"
const readerId = "77777777-7777-4777-8777-777777777777"
const editorRole = "99999999-9999-4999-8999-999999999999"
const headers = { Origin: origin, "X-Tenant-Id": tenant }

async function session(context: BrowserContext, reader = false) {
  const iv = randomBytes(12)
  const key = createHash("sha256").update(process.env.ERP_SESSION_SECRET!).digest()
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: reader ? "fixture-reader-token" : "fixture-editor-token", tenantId: tenant, expiresAt: Date.now() + 3600_000 })), cipher.final()])
  await context.addCookies([{ name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" }])
}

test("papel criado, alterado e excluído pelo navegador persiste no PostgreSQL", async ({ page, context }) => {
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()) })
  await session(context)
  await page.goto("/preferencias/papeis")
  await page.getByRole("button", { name: "Novo papel", exact: true }).click()
  await page.getByLabel("Código do papel").fill("consulta-browser")
  await page.getByLabel("Nome do papel").fill("Consulta pelo navegador")
  await page.getByRole("checkbox", { name: /platform.company.read/ }).check()
  await page.getByRole("button", { name: "Salvar papel", exact: true }).click()
  await expect(page.getByText("Papel salvo no servidor.", { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole("button", { name: "Consulta pelo navegador", exact: true }).click()
  await expect(page.getByRole("checkbox", { name: /platform.company.read/ })).toBeChecked()
  await page.getByLabel("Descrição do papel").fill("Gravado no banco real")
  await page.getByRole("button", { name: "Salvar papel", exact: true }).click()
  await expect(page.getByText("Revisão 2", { exact: true })).toBeVisible()
  await page.evaluate(() => { window.scrollTo(0, 0); if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
  await page.screenshot({ path: "../../evidencias/screenshots/erp-access-desktop.png", fullPage: true })
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: "Excluir papel", exact: true }).click()
  await expect(page.getByText("Papel excluído no servidor.", { exact: true })).toBeVisible()
  expect((await (await context.request.get("/api/erp/roles")).json()).data.some((role: { code: string }) => role.code === "consulta-browser")).toBe(false)
  expect(errors).toEqual([])
})

test("conflito de papel preserva o rascunho e exige descarte explícito", async ({ page, context }) => {
  await session(context)
  await page.goto("/preferencias/papeis")
  await page.getByRole("button", { name: "Leitor", exact: true }).click()
  const path = "/api/erp/roles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const remote = await context.request.get(path)
  const data = await remote.json()
  const payload = { code: data.code, name: data.name, description: "Outra revisão remota", permissions: data.permissions }
  expect((await context.request.put(path, { headers: { ...headers, "If-Match": remote.headers().etag }, data: payload })).status()).toBe(200)
  await page.getByLabel("Descrição do papel").fill("Meu rascunho preservado")
  await page.getByRole("button", { name: "Salvar papel", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Outra pessoa alterou" })).toBeVisible()
  await expect(page.getByLabel("Descrição do papel")).toHaveValue("Meu rascunho preservado")
  await expect(page.getByRole("button", { name: "Salvar papel", exact: true })).toBeDisabled()
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: "Recarregar e descartar edição" }).click()
  await expect(page.getByLabel("Descrição do papel")).toHaveValue("Outra revisão remota")
})

test("associação bloqueada perde acesso imediatamente e pode ser reativada por administrador", async ({ page, context, browser }) => {
  await session(context)
  await page.goto("/preferencias/usuarios")
  await page.getByRole("link", { name: "Consultar acesso de Leitor" }).click()
  await expect(page.getByLabel("Nome no Auth")).toBeDisabled()
  await page.getByLabel("Situação do acesso").selectOption("blocked")
  await page.getByRole("button", { name: "Salvar acesso", exact: true }).click()
  await expect(page.getByText("Acesso salvo no servidor.", { exact: true })).toBeVisible()
  const reader = await browser.newContext({ baseURL: origin })
  try { await session(reader, true); expect((await reader.request.get("/api/erp/me")).status()).toBe(403) } finally { await reader.close() }
  await page.reload()
  await expect(page.getByLabel("Situação do acesso")).toHaveValue("blocked")
  await page.getByLabel("Situação do acesso").selectOption("active")
  await page.getByRole("button", { name: "Salvar acesso", exact: true }).click()
  await expect(page.getByText("Acesso salvo no servidor.", { exact: true })).toBeVisible()
  expect((await (await context.request.get(`/api/erp/users/${readerId}`)).json()).status).toBe("active")
  await page.getByLabel("Situação do acesso").selectOption("blocked")
  await expect(page.getByText("Acesso salvo no servidor.", { exact: true })).toHaveCount(0)
})

test("último administrador é protegido também pela tela de permissões", async ({ page, context }) => {
  await session(context)
  await page.goto("/preferencias/papeis")
  await page.getByRole("button", { name: "Editor", exact: true }).click()
  await page.getByRole("checkbox", { name: /platform.roles.manage/ }).uncheck()
  await page.getByRole("button", { name: "Salvar papel", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "ao menos um administrador ativo" })).toBeVisible()
  expect((await (await context.request.get(`/api/erp/roles/${editorRole}`)).json()).permissions).toContain("platform.roles.manage")
})

test("acesso de consulta e layout móvel usam dados reais", async ({ page, context }) => {
  await session(context, true)
  await page.setViewportSize({ width: 375, height: 844 })
  await page.goto(`/preferencias/usuarios/${readerId}`)
  await expect(page.getByText("Acesso somente de consulta.", { exact: false })).toBeVisible()
  await expect(page.getByLabel("Situação do acesso")).toBeDisabled()
  await expect(page.getByRole("checkbox", { name: /Leitor/ })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.screenshot({ path: "../../evidencias/screenshots/erp-access-mobile.png", fullPage: true })
  await page.goto("/preferencias/papeis")
  await expect(page.getByRole("button", { name: "Novo papel", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Editor", exact: true }).click()
  await expect(page.getByLabel("Nome do papel")).toBeDisabled()
})

test("BFF mantém autenticação, origem, revisão e idempotência nas operações de acesso", async ({ context }) => {
  expect((await context.request.get("/api/erp/users")).status()).toBe(401)
  await session(context)
  const data = { code: "replay-bff", name: "Reenvio", permissions: ["platform.company.read"] }
  const command = { ...headers, "Idempotency-Key": randomUUID() }
  expect((await context.request.post("/api/erp/roles", { headers: { ...command, Origin: "https://untrusted.example" }, data })).status()).toBe(403)
  const first = await context.request.post("/api/erp/roles", { headers: command, data })
  expect(first.status()).toBe(201)
  const replay = await context.request.post("/api/erp/roles", { headers: command, data })
  expect(replay.status()).toBe(201)
  expect(replay.headers()["idempotency-replayed"]).toBe("true")
  expect(await replay.json()).toEqual(await first.json())
  expect((await context.request.post("/api/erp/roles", { headers: command, data: { ...data, name: "Outra intenção" } })).status()).toBe(409)
  const id = (await first.json()).id
  expect((await context.request.put(`/api/erp/roles/${id}`, { headers, data })).status()).toBe(428)
  expect((await context.request.post("/api/erp/roles", { headers: command, data: { ...data, description: "x".repeat(70_000) } })).status()).toBe(413)
  expect((await context.request.get("/api/erp/roles/invalid")).status()).toBe(404)
})

test("perda da resposta após gravação permite reenviar a mesma criação sem duplicar", async ({ page, context }) => {
  await session(context)
  let first = true
  const keys: string[] = []
  await page.route("**/api/erp/roles", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    keys.push(route.request().headers()["idempotency-key"])
    if (!first) return route.continue()
    first = false
    const committed = await route.fetch()
    expect(committed.status()).toBe(201)
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ title: "Falha de confirmação injetada pelo teste" }) })
  })
  await page.goto("/preferencias/papeis")
  await page.getByRole("button", { name: "Novo papel", exact: true }).click()
  await page.getByLabel("Código do papel").fill("lost-response")
  await page.getByLabel("Nome do papel").fill("Resposta perdida")
  await page.getByRole("button", { name: "Salvar papel", exact: true }).click()
  await expect(page.getByLabel("Nome do papel")).toBeDisabled()
  await page.getByRole("button", { name: "Reenviar mesma criação", exact: true }).click()
  await expect(page.getByText("Papel salvo no servidor.", { exact: true })).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBe(keys[1])
  expect((await (await context.request.get("/api/erp/roles")).json()).data.filter((role: { code: string }) => role.code === "lost-response")).toHaveLength(1)
})
