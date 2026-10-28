import { test, expect, type BrowserContext } from "@playwright/test"
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto"

const origin = process.env.ERP_TEST_WEB_ORIGIN || "http://127.0.0.1:3202"
const tenant = "11111111-1111-4111-8111-111111111111"
const headers = { Origin: origin, "X-Tenant-Id": tenant }
const resources = [
  { page: "categorias-produtos", api: "product-categories", extra: { parentId: null, sortOrder: 7 } },
  { page: "categorias-financeiras", api: "financial-categories", extra: { parentId: null, direction: "expense" } },
  { page: "contas-financeiras", api: "financial-accounts", extra: { accountType: "bank", bank: "Banco declarado de teste", branch: "0001", accountNumber: "123-4" } },
  { page: "formas-pagamento", api: "payment-methods", extra: { modality: "credit_card", settlementDays: 2 } },
] as const

async function session(context: BrowserContext, reader = false) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(process.env.ERP_SESSION_SECRET!).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: reader ? "fixture-reader-token" : "fixture-editor-token", tenantId: tenant, expiresAt: Date.now() + 3600_000 })), cipher.final()])
  await context.addCookies([{ name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" }])
}

for (const config of resources) {
  test(`${config.page}: cria, consulta, edita e filtra cadastro persistente`, async ({ page, context }) => {
    await session(context)
    const code = `REF-${randomUUID().slice(0, 8).toUpperCase()}`
    const name = `Cadastro ${config.page} do navegador`
    await page.setViewportSize({ width: 320, height: 844 })
    await page.goto(`/cadastros/${config.page}`)
    await page.getByRole("link", { name: "Novo cadastro", exact: true }).click()
    await page.getByRole("textbox", { name: "Código", exact: true }).fill(code)
    await page.getByRole("textbox", { name: "Nome", exact: true }).fill(name)
    await page.getByRole("textbox", { name: "Observações", exact: true }).fill("Observação persistida no PostgreSQL")
    if (config.page === "categorias-produtos") await page.getByRole("spinbutton", { name: "Ordem de exibição", exact: true }).fill("7")
    if (config.page === "categorias-financeiras") await page.getByRole("combobox", { name: "Natureza", exact: true }).selectOption("expense")
    if (config.page === "contas-financeiras") {
      await page.getByRole("textbox", { name: "Banco", exact: true }).fill("Banco declarado de teste")
      await page.getByRole("textbox", { name: "Agência", exact: true }).fill("0001")
      await page.getByRole("textbox", { name: "Número da conta", exact: true }).fill("123-4")
    }
    if (config.page === "formas-pagamento") {
      await page.getByRole("combobox", { name: "Modalidade", exact: true }).selectOption("credit_card")
      await page.getByRole("spinbutton", { name: "Prazo de referência (dias)", exact: true }).fill("2")
    }
    let lost = false
    const requests: { key: string; body: string | null }[] = []
    if (config.page === "formas-pagamento") await page.route(`**/api/erp/${config.api}`, async route => {
      if (route.request().method() !== "POST") return route.continue()
      requests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() })
      if (!lost) { const committed = await route.fetch(); expect(committed.status()).toBe(201); lost = true; return route.abort("failed") }
      return route.continue()
    })
    await page.getByRole("button", { name: "Salvar cadastro", exact: true }).click()
    if (config.page === "formas-pagamento") {
      await expect(page.getByRole("textbox", { name: "Nome", exact: true })).toBeDisabled()
      await page.getByRole("button", { name: "Conferir gravação", exact: true }).click()
      expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1])
    }
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
    const id = new URL(page.url()).pathname.split("/").at(-1)!
    await page.reload()
    await expect(page.getByText("Observação persistida no PostgreSQL", { exact: true })).toBeVisible()
    const created = await context.request.get(`/api/erp/${config.api}/${id}`)
    expect(created.status()).toBe(200)
    expect((await created.json()).data).toMatchObject({ code, name, ...config.extra })
    await page.getByRole("link", { name: "Editar cadastro", exact: true }).click()
    await page.getByRole("textbox", { name: "Nome", exact: true }).fill(`${name} revisado`)
    await page.getByRole("combobox", { name: "Situação", exact: true }).selectOption("archived")
    let lostUpdate = false
    const updates: { key: string; body: string | null; revision: string }[] = []
    if (config.page === "contas-financeiras") await page.route(`**/api/erp/${config.api}/${id}`, async route => {
      if (route.request().method() !== "PUT") return route.continue()
      updates.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData(), revision: route.request().headers()["if-match"] })
      if (!lostUpdate) { const committed = await route.fetch(); expect(committed.status()).toBe(200); lostUpdate = true; return route.abort("failed") }
      return route.continue()
    })
    await page.getByRole("button", { name: "Salvar cadastro", exact: true }).click()
    if (config.page === "contas-financeiras") {
      await expect(page.getByRole("textbox", { name: "Nome", exact: true })).toBeDisabled()
      await page.getByRole("button", { name: "Conferir gravação", exact: true }).click()
      expect(updates).toHaveLength(2); expect(updates[0]).toEqual(updates[1])
    }
    await expect(page.getByRole("heading", { name: `${name} revisado`, exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByText("Arquivado", { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await page.screenshot({ path: `../../evidencias/screenshots/erp-${config.page}-persistente.png`, fullPage: true })
    await page.getByRole("link", { name: "Voltar à listagem", exact: true }).click()
    await page.getByRole("textbox", { name: "Buscar nome ou código", exact: true }).fill(code)
    await page.getByRole("combobox", { name: "Situação", exact: true }).selectOption("archived")
    await page.getByRole("button", { name: "Buscar", exact: true }).click()
    await expect(page.getByText("1 registro(s) · Consulta e edição", { exact: true })).toBeVisible()
    await expect(page.getByRole("link", { name: `${name} revisado`, exact: true })).toHaveAttribute("href", `/cadastros/${config.page}/${id}`)
  })
}

test("hierarquia seleciona categoria real e recusa ciclos e arquivamento com subcategoria ativa", async ({ page, context }) => {
  await session(context)
  const code = `TREE-${randomUUID().slice(0, 8).toUpperCase()}`
  const root = await context.request.post("/api/erp/product-categories", { headers: { ...headers, "Idempotency-Key": randomUUID() }, data: { code, name: "Raiz da hierarquia do navegador", status: "active", notes: null, parentId: null, sortOrder: 0 } })
  expect(root.status()).toBe(201)
  const rootId = (await root.json()).data.id
  await page.goto("/cadastros/categorias-produtos/novo")
  await page.getByRole("textbox", { name: "Código", exact: true }).fill(`${code}-SUB`)
  await page.getByRole("textbox", { name: "Nome", exact: true }).fill("Subcategoria do navegador")
  await page.getByRole("textbox", { name: "Buscar categoria superior", exact: true }).fill(code)
  await page.getByRole("button", { name: "Pesquisar categoria", exact: true }).click()
  await page.getByRole("button", { name: `Usar Raiz da hierarquia do navegador · ${code}`, exact: true }).click()
  await page.getByRole("button", { name: "Salvar cadastro", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Subcategoria do navegador", exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Raiz da hierarquia do navegador", exact: true })).toHaveAttribute("href", `/cadastros/categorias-produtos/${rootId}`)
  await page.goto(`/cadastros/categorias-produtos/${rootId}/editar`)
  await page.getByRole("textbox", { name: "Buscar categoria superior", exact: true }).fill(`${code}-SUB`)
  await page.getByRole("button", { name: "Pesquisar categoria", exact: true }).click()
  await page.getByRole("button", { name: `Usar Subcategoria do navegador · ${code}-SUB`, exact: true }).click()
  await page.getByRole("button", { name: "Salvar cadastro", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "criaria um ciclo" })).toBeVisible()
  await page.getByRole("button", { name: "Sem categoria superior", exact: true }).click()
  await page.getByRole("combobox", { name: "Situação", exact: true }).selectOption("archived")
  await page.getByRole("button", { name: "Salvar cadastro", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "subcategorias ativas" })).toBeVisible()
})

test("conflito preserva campos e exige descarte confirmado; consulta bloqueia escrita", async ({ page, context }) => {
  await session(context)
  const code = `REV-${randomUUID().slice(0, 8).toUpperCase()}`
  const payload = { code, name: "Nome inicial auxiliar", status: "active", notes: null, modality: "pix", settlementDays: 0 }
  const created = await context.request.post("/api/erp/payment-methods", { headers: { ...headers, "Idempotency-Key": randomUUID() }, data: payload })
  expect(created.status()).toBe(201)
  const id = (await created.json()).data.id
  await page.goto(`/cadastros/formas-pagamento/${id}/editar`)
  const name = page.getByRole("textbox", { name: "Nome", exact: true })
  await name.fill("Edição local preservada")
  const remote = await context.request.put(`/api/erp/payment-methods/${id}`, { headers: { ...headers, "If-Match": '"1"', "Idempotency-Key": randomUUID() }, data: { ...payload, name: "Edição remota confirmada" } })
  expect(remote.status()).toBe(200)
  await page.getByRole("button", { name: "Salvar cadastro", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Outra pessoa alterou" })).toBeVisible()
  await expect(name).toHaveValue("Edição local preservada")
  page.once("dialog", dialog => dialog.dismiss())
  await page.getByRole("button", { name: "Recarregar cadastro", exact: true }).click()
  await expect(name).toHaveValue("Edição local preservada")
  page.once("dialog", dialog => dialog.accept())
  await page.getByRole("button", { name: "Recarregar cadastro", exact: true }).click()
  await expect(name).toHaveValue("Edição remota confirmada")
  await session(context, true)
  for (const config of resources) {
    await page.goto(`/cadastros/${config.page}/novo`)
    await expect(page.getByRole("status")).toContainText("Somente consulta")
    await expect(page.getByRole("button", { name: "Salvar cadastro", exact: true })).toHaveCount(0)
  }
  const denied = await context.request.put(`/api/erp/payment-methods/${id}`, { headers: { ...headers, "If-Match": '"2"', "Idempotency-Key": randomUUID() }, data: payload })
  expect(denied.status()).toBe(403)
})

test("BFF dos cadastros auxiliares recusa anônimo, origem, troca de empresa e filtros desconhecidos", async ({ context }) => {
  for (const config of resources) expect((await context.request.get(`/api/erp/${config.api}`)).status()).toBe(401)
  await session(context)
  for (const config of resources) {
    const data = { code: "SECURITY", name: "Cadastro de segurança", status: "active", notes: null, ...config.extra }
    expect((await context.request.post(`/api/erp/${config.api}`, { headers: { ...headers, Origin: "https://external.example", "Idempotency-Key": randomUUID() }, data })).status()).toBe(403)
    expect((await context.request.post(`/api/erp/${config.api}`, { headers: { ...headers, "X-Tenant-Id": "22222222-2222-4222-8222-222222222222", "Idempotency-Key": randomUUID() }, data })).status()).toBe(409)
    expect((await context.request.get(`/api/erp/${config.api}?balance=all`)).status()).toBe(400)
    expect((await context.request.get(`/api/erp/${config.api}?q=a&q=b`)).status()).toBe(400)
    expect((await context.request.get(`/api/erp/${config.api}/invalid-id`)).status()).toBe(400)
    expect((await context.request.post(`/api/erp/${config.api}`, { headers, data })).status()).toBe(428)
  }
})
