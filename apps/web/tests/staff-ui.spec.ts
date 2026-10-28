import { expect, test } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"

test.setTimeout(12_000)
const origin = "http://127.0.0.1:33118"
const tenant = "11111111-1111-4111-8111-111111111111"
const id = "22222222-2222-4222-8222-222222222222"
const secret = "danfe-browser-fixture-not-a-real-service-secret"
type Staff = { id: string; revision: number; code: string; name: string; jobTitle: string | null; email: string | null; phone: string | null; isEmployee: boolean; isSeller: boolean; status: string }
let data: Staff | null = null
let canEdit = true
let refuse = false
const queries: string[] = []
const upstream = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json")
  expect(request.headers.authorization).toBe("Bearer staff-fixture-token")
  expect(request.headers["x-tenant-id"]).toBe(tenant)
  const url = new URL(request.url!, "http://fixture.invalid")
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
    const rows = data && (!role || role === "employee" && data.isEmployee || role === "seller" && data.isSeller) ? [data] : []
    response.end(JSON.stringify({ tenantId: tenant, canEdit, data: rows, total: rows.length })); return
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
  await page.getByLabel("Situação").selectOption("archived")
  await page.getByRole("button", { name: "Salvar cadastro", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Cadastro salvo" })).toBeVisible()
  expect(data!.status).toBe("archived")
  await page.getByLabel("Situação").selectOption("active")
  await page.getByRole("button", { name: "Salvar cadastro", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Cadastro salvo" })).toBeVisible()
  expect(data!.status).toBe("active")
  canEdit = false
  await page.goto(`/cadastros/funcionarios/${id}/editar`)
  await expect(page.getByLabel("Nome", { exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Salvar cadastro", exact: true })).toBeDisabled()
})
