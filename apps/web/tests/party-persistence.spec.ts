import { test, expect, type BrowserContext } from "@playwright/test"
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto"

const origin = process.env.ERP_TEST_WEB_ORIGIN || "http://127.0.0.1:3202"
const tenant = "11111111-1111-4111-8111-111111111111"
const headers = { Origin: origin, "X-Tenant-Id": tenant }
const directory = "/cadastros/clientes-fornecedores"
const input = { personType: "juridica", legalName: "Parceiro de integração", tradeName: null, taxId: "04252011000110", email: null, phone: null, isCustomer: true, isSupplier: false, status: "active" }

async function session(context: BrowserContext, reader = false) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(process.env.ERP_SESSION_SECRET!).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: reader ? "fixture-reader-token" : "fixture-editor-token", tenantId: tenant, expiresAt: Date.now() + 3600_000 })), cipher.final()])
  await context.addCookies([{ name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" }])
}

test("pessoa é criada, assume os dois papéis e pode ser arquivada sem duplicar identidade", async ({ page, context }) => {
  await session(context)
  await page.setViewportSize({ width: 375, height: 844 })
  await page.goto(directory)
  await page.getByRole("link", { name: "Nova pessoa", exact: true }).click()
  await page.getByRole("textbox", { name: "Nome ou razão social", exact: true }).fill("Indústria parceira do navegador")
  await page.getByRole("textbox", { name: "CPF ou CNPJ", exact: true }).fill("04.252.011/0001-10")
  await page.getByRole("textbox", { name: "E-mail", exact: true }).fill("contato@example.test")
  await page.getByRole("button", { name: "Salvar pessoa", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Indústria parceira do navegador", exact: true })).toBeVisible()
  await expect(page.getByText("04252011000110", { exact: true })).toBeVisible()
  await page.getByRole("link", { name: "Editar pessoa", exact: true }).click()
  await page.getByRole("checkbox", { name: "Fornecedor", exact: true }).check()
  await page.getByRole("button", { name: "Salvar pessoa", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Pessoa salva no servidor." })).toBeVisible()
  await page.getByRole("combobox", { name: "Situação", exact: true }).selectOption("archived")
  await expect(page.getByRole("status").filter({ hasText: "Pessoa salva no servidor." })).toHaveCount(0)
  await page.getByRole("button", { name: "Salvar pessoa", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Pessoa salva no servidor." })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("checkbox", { name: "Cliente", exact: true })).toBeChecked()
  await expect(page.getByRole("checkbox", { name: "Fornecedor", exact: true })).toBeChecked()
  await expect(page.getByRole("combobox", { name: "Situação", exact: true })).toHaveValue("archived")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const save = await page.getByRole("button", { name: "Salvar pessoa", exact: true }).boundingBox()
  const nav = await page.getByRole("navigation", { name: "Navegação móvel", exact: true }).boundingBox()
  expect(save!.y + save!.height).toBeLessThanOrEqual(nav!.y)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: "../../evidencias/screenshots/erp-pessoas-mobile-persistente.png", fullPage: true })
  await page.getByRole("link", { name: "Voltar à listagem", exact: true }).click()
  await page.getByRole("combobox", { name: "Relacionamento", exact: true }).selectOption("supplier")
  await page.getByRole("combobox", { name: "Situação", exact: true }).selectOption("archived")
  await page.locator("#conteudo-principal").getByRole("button", { name: "Buscar", exact: true }).click()
  await expect(page.getByRole("link", { name: "Consultar Indústria parceira do navegador", exact: true })).toBeVisible()
})

test("conflito de revisão preserva a edição e só recarrega com descarte confirmado", async ({ page, context }) => {
  await session(context)
  const data = { ...input, taxId: "12ABC34501DE35", legalName: "Pessoa inicial" }
  const created = await context.request.post("/api/erp/parties", { headers: { ...headers, "Idempotency-Key": randomUUID() }, data })
  expect(created.status()).toBe(201)
  const id = (await created.json()).data.id
  await page.goto(`${directory}/${id}/editar`)
  const name = page.getByRole("textbox", { name: "Nome ou razão social", exact: true })
  await expect(name).toHaveValue("Pessoa inicial")
  const remote = await context.request.get(`/api/erp/parties/${id}`)
  expect((await context.request.put(`/api/erp/parties/${id}`, { headers: { ...headers, "If-Match": remote.headers().etag }, data: { ...data, legalName: "Revisão remota da pessoa" } })).status()).toBe(200)
  await name.fill("Edição local preservada")
  await page.getByRole("button", { name: "Salvar pessoa", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Outra pessoa alterou" })).toBeVisible()
  await expect(name).toHaveValue("Edição local preservada")
  await expect(page.getByRole("button", { name: "Salvar pessoa", exact: true })).toBeDisabled()
  page.once("dialog", dialog => dialog.dismiss())
  await page.getByRole("button", { name: "Recarregar cadastro", exact: true }).click()
  await expect(name).toHaveValue("Edição local preservada")
  page.once("dialog", dialog => dialog.accept())
  await page.getByRole("button", { name: "Recarregar cadastro", exact: true }).click()
  await expect(name).toHaveValue("Revisão remota da pessoa")
})

test("criação com resposta perdida confere o mesmo comando sem duplicar pessoa", async ({ page, context }) => {
  await session(context)
  await page.goto(`${directory}/novo`)
  await page.getByRole("combobox", { name: "Tipo de pessoa", exact: true }).selectOption("fisica")
  await page.getByRole("textbox", { name: "Nome ou razão social", exact: true }).fill("Pessoa com confirmação interrompida")
  await page.getByRole("textbox", { name: "CPF ou CNPJ", exact: true }).fill("52998224725")
  const keys: string[] = []
  let interrupted = false
  await page.route("**/api/erp/parties", async route => {
    if (route.request().method() !== "POST") return route.continue()
    keys.push(route.request().headers()["idempotency-key"])
    if (!interrupted) {
      const committed = await route.fetch()
      expect(committed.status()).toBe(201)
      interrupted = true
      return route.abort("failed")
    }
    return route.continue()
  })
  await page.getByRole("button", { name: "Salvar pessoa", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Nome ou razão social", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Conferir gravação", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Pessoa com confirmação interrompida", exact: true })).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBe(keys[1])
  const response = await context.request.get("/api/erp/parties?q=52998224725")
  expect((await response.json()).total).toBe(1)
})

test("consulta não permite alterar pessoas e mantém o formulário dentro de 320 pixels", async ({ page, context }) => {
  await session(context)
  const data = { ...input, personType: "fisica", taxId: "11144477735", legalName: "Pessoa de consulta" }
  const created = await context.request.post("/api/erp/parties", { headers: { ...headers, "Idempotency-Key": randomUUID() }, data })
  expect(created.status()).toBe(201)
  const id = (await created.json()).data.id
  await session(context, true)
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto(`${directory}/${id}/editar`)
  await expect(page.getByRole("status").filter({ hasText: "Somente consulta" })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Nome ou razão social", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Salvar pessoa", exact: true })).toBeDisabled()
  expect((await context.request.put(`/api/erp/parties/${id}`, { headers: { ...headers, "If-Match": '"1"' }, data: { ...data, legalName: "Não deve mudar" } })).status()).toBe(403)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test("BFF e API recusam duplicidade, documento inválido, falta de precondição e origem externa", async ({ context }) => {
  await session(context)
  const request = context.request
  const create = (data: object) => request.post("/api/erp/parties", { headers: { ...headers, "Idempotency-Key": randomUUID() }, data })
  const duplicate = { ...input, personType: "fisica", taxId: "12345678909", legalName: "Duplicidade controlada" }
  expect((await create(duplicate)).status()).toBe(201)
  expect((await create(duplicate)).status()).toBe(409)
  expect((await create({ ...input, taxId: "00000000000000" })).status()).toBe(422)
  expect((await create({ ...input, isCustomer: false, isSupplier: false })).status()).toBe(422)
  expect((await request.post("/api/erp/parties", { headers, data: input })).status()).toBe(428)
  expect((await request.post("/api/erp/parties", { headers: { ...headers, Origin: "https://outside.example.test", "Idempotency-Key": randomUUID() }, data: input })).status()).toBe(403)
  expect((await request.get("/api/erp/parties?role=customer&role=supplier")).status()).toBe(400)
  expect((await request.get("/api/erp/parties?tenantId=other")).status()).toBe(400)
  await context.clearCookies()
  expect((await request.get("/api/erp/parties")).status()).toBe(401)
})
