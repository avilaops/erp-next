import { expect, test } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"

test.setTimeout(process.env.ERP_BROWSER_DEV === "1" ? 35_000 : 12_000)
const origin = "http://127.0.0.1:33118"
const tenant = "11111111-1111-4111-8111-111111111111"
const id = "22222222-2222-4222-8222-222222222222"
const secret = "danfe-browser-fixture-not-a-real-service-secret"
type Staff = { id: string; revision: number; code: string; name: string; jobTitle: string | null; email: string | null; phone: string | null; isEmployee: boolean; isSeller: boolean; status: string }
let data: Staff | null = null
let canEdit = true
let refuse = false
const queries: string[] = []
let listRows: Staff[] | null = null
let listError = false
const searches: URL[] = []
const upstream = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json")
  expect(request.headers.authorization).toBe("Bearer staff-fixture-token")
  expect(request.headers["x-tenant-id"]).toBe(tenant)
  const url = new URL(request.url!, "http://fixture.invalid")
  if (url.pathname.endsWith("/payroll")) {response.writeHead(403);response.end(JSON.stringify({title:"Sem acesso financeiro"}));return}
  if (request.method === "POST" || request.method === "PUT") {
    let body = ""; for await (const chunk of request) body += chunk
    const input = JSON.parse(body)
    if (request.method === "POST") expect(request.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/)
    else expect(request.headers["if-match"]).toBe(`"${data!.revision}"`)
    if (refuse) { response.writeHead(412); response.end(JSON.stringify({ title: "Revisão divergente" })); return }
    data = { ...input, code: input.code.trim().toUpperCase(), name: input.name.trim(), id, revision: (data?.revision || 0) + 1 }
    if (request.method === "POST") response.statusCode = 201
  }
  if (request.method === "GET" && url.pathname === "/api/v1/staff") {
    const role = url.searchParams.get("role") || ""; queries.push(role)
    searches.push(url)
    if (listError) { response.writeHead(503); response.end(JSON.stringify({ title: "Consulta temporariamente indisponível" })); return }
    const search = (url.searchParams.get("q") || "").toLocaleLowerCase("pt-BR")
    const status = url.searchParams.get("status") || ""
    const offset = Number(url.searchParams.get("offset") || 0)
    const limit = Number(url.searchParams.get("limit") || 25)
    const rows = (listRows || (data ? [data] : [])).filter(row => (!role || role === "employee" && row.isEmployee || role === "seller" && row.isSeller)
      && (!status || row.status === status) && `${row.name} ${row.code}`.toLocaleLowerCase("pt-BR").includes(search))
    response.end(JSON.stringify({ tenantId: tenant, canEdit, data: rows.slice(offset, offset + limit), total: rows.length })); return
  }
  response.setHeader("ETag", `"${data?.revision || 0}"`)
  response.end(JSON.stringify({ tenantId: tenant, canEdit, data }))
})
function cookie() {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "staff-fixture-token", tenantId: tenant, expiresAt: Date.now() + 3600_000 })), cipher.final()])
  return { name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" as const }
}
test.beforeAll(async () => { await new Promise<void>(resolve => upstream.listen(33119, "127.0.0.1", resolve)) })
test.afterAll(async () => { await new Promise<void>(resolve => upstream.close(() => resolve())) })
test.beforeEach(() => { data = null; canEdit = true; refuse = false; listRows = null; listError = false; queries.length = 0; searches.length = 0 })

test("staff and sellers use one persisted record, preserve rejected edits and disable unauthorized changes", async ({ page, context }) => {
  expect((await context.request.get("/api/erp/staff")).status()).toBe(401)
  await context.addCookies([cookie()])
  await page.goto("/cadastros/funcionarios/novo")
  await page.getByLabel("Nome", { exact: true }).fill("Maria")
  await page.getByLabel("Código", { exact: true }).fill("eq-001")
  await expect(page.getByLabel("Funcionário", { exact: true })).toBeChecked()
  await expect(page.getByLabel("Vendedor", { exact: true })).not.toBeChecked()
  await page.getByLabel("Vendedor", { exact: true }).check()
  await page.getByRole("button", { name: "Salvar cadastro", exact: true }).click()
  await page.waitForURL(`**/cadastros/funcionarios/${id}`)
  await expect(page.getByText("EQ-001", { exact: true })).toBeVisible()
  await expect(page.getByText("Funcionário e vendedor", { exact: true })).toBeVisible()
  await page.goto("/cadastros/vendedores")
  await page.getByLabel("Buscar vendedor", { exact: true }).fill("Maria")
  await page.getByRole("link", { name: "Consultar Maria", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/cadastros/vendedores/${id}$`))
  expect(queries).toContain("seller")
  await page.getByRole("link", { name: "Editar cadastro", exact: true }).click()
  await page.getByLabel("Nome", { exact: true }).fill("Edição preservada")
  refuse = true
  await page.getByRole("button", { name: "Salvar cadastro", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Revisão divergente" })).toBeVisible()
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("Edição preservada")
  refuse = false
  page.once("dialog", dialog => dialog.accept())
  await page.getByRole("button", { name: "Recarregar cadastro", exact: true }).click()
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("Maria")
  await page.getByLabel("Situação do cadastro", { exact: true }).selectOption("archived")
  page.once("dialog", dialog => dialog.accept())
  await page.getByRole("button", { name: "Salvar cadastro", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Cadastro salvo" })).toBeVisible()
  expect(data!.status).toBe("archived")
  await page.getByLabel("Situação do cadastro", { exact: true }).selectOption("active")
  await page.getByRole("button", { name: "Salvar cadastro", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Cadastro salvo" })).toBeVisible()
  expect(data!.status).toBe("active")
  canEdit = false
  await page.goto(`/cadastros/funcionarios/${id}/editar`)
  await expect(page.getByLabel("Nome", { exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Salvar cadastro", exact: true })).toBeDisabled()
})

test("seller search follows proposal lookup with keyboard, paging, status, read-only access and recovery", async ({ page, context }, testInfo) => {
  test.setTimeout(25_000)
  listRows = Array.from({ length: 12 }, (_, index) => ({
    id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`,
    revision: 1, name: index === 0 ? "Daniel Matheus Pontes Genivá" : `Daniel Pessoa ${index + 1}`,
    code: `VND-${String(index + 1).padStart(3, "0")}`, jobTitle: null, email: null, phone: null,
    isEmployee: true, isSeller: true, status: index === 11 ? "archived" : "active",
  }))
  listRows.push({ ...listRows[0], id, name: "Daniel interno", code: "INT-001", isSeller: false })
  listRows.push({ ...listRows[0], id: "44444444-4444-4444-8444-444444444444", name: "Fabio", code: "VND-013" })
  await context.addCookies([cookie()])
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto("/cadastros/vendedores")
  await expect(page.getByRole("heading", { name: "Equipe cadastrada" })).toHaveCount(0)
  const results = page.getByRole("region", { name: "Resultados de vendedores" })
  await expect(results).toBeHidden()
  const input = page.getByLabel("Buscar vendedor", { exact: true })
  await page.getByLabel("Filtrar por situação").selectOption("active")
  await input.fill("Daniel")
  await expect(results.getByRole("link", { name: /^Consultar / })).toHaveCount(10)
  await expect(results.getByText("Daniel interno", { exact: true })).toHaveCount(0)
  await expect(results.getByText("Fabio", { exact: true })).toHaveCount(0)
  await expect(results.getByRole("link", { name: "Cadastrar vendedor" })).toHaveAttribute("href", "/cadastros/vendedores/novo")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath("vendedores-busca-mobile.png"), fullPage: true })
  await results.getByRole("button", { name: "Próximo vendedor", exact: true }).click()
  await expect(results.getByRole("link", { name: /^Consultar / })).toHaveCount(1)
  await expect(results.getByRole("link", { name: "Consultar Daniel Pessoa 11", exact: true })).toBeVisible()
  expect(searches.at(-1)!.searchParams.get("q")).toBe("Daniel")
  expect(searches.at(-1)!.searchParams.get("role")).toBe("seller")
  expect(searches.at(-1)!.searchParams.get("status")).toBe("active")
  expect(searches.at(-1)!.searchParams.get("offset")).toBe("10")
  await results.getByRole("button", { name: "Anterior vendedor", exact: true }).click()
  await expect(results.getByRole("link", { name: /^Consultar / })).toHaveCount(10)
  await input.press("Escape")
  await expect(results).toBeHidden()
  await expect(input).toBeFocused()
  await input.press("Enter")
  await expect(results).toBeVisible()
  await page.getByRole("heading", { name: "Vendedores", exact: true }).click()
  await expect(results).toBeHidden()
  await expect(input).toHaveValue("Daniel")
  await page.getByLabel("Filtrar por situação").selectOption("archived")
  await page.getByRole("button", { name: "Pesquisar vendedor", exact: true }).click()
  await expect(results.getByRole("link", { name: "Consultar Daniel Pessoa 12", exact: true })).toHaveAttribute("href", "/cadastros/vendedores/33333333-3333-4333-8333-000000000012")
  await expect(results.getByText("VND-012 · Desligado", { exact: true })).toBeVisible()
  listError = true
  await page.getByRole("button", { name: "Pesquisar vendedor", exact: true }).click()
  await expect(results.getByRole("alert")).toContainText("Consulta temporariamente indisponível")
  await expect(results.getByRole("link", { name: /^Consultar / })).toHaveCount(0)
  canEdit = false; listError = false
  await results.getByRole("button", { name: "Tentar novamente", exact: true }).click()
  await expect(results.getByRole("link", { name: /^Consultar / })).toHaveCount(1)
  await expect(results.getByRole("link", { name: "Cadastrar vendedor" })).toHaveCount(0)
  await expect(results.getByText("Somente consulta.", { exact: true })).toBeVisible()
  await input.fill("Sem correspondência")
  await expect(results.getByText("Nenhum vendedor encontrado.", { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByLabel("Filtrar por situação").selectOption("")
  await input.fill("Daniel")
  await expect(results.getByRole("link", { name: /^Consultar / })).toHaveCount(10)
  await page.screenshot({ path: testInfo.outputPath("vendedores-busca-desktop.png"), fullPage: true })
})
