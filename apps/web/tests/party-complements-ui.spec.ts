import { expect, test } from "@playwright/test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"

test.setTimeout(10_000)
const origin = "http://127.0.0.1:33118"
const tenant = "11111111-1111-4111-8111-111111111111"
const id = "22222222-2222-4222-8222-222222222222"
const secret = "danfe-browser-fixture-not-a-real-service-secret"
const blank = () => ({ id, revision: 1, personType: "juridica", legalName: "Parceira", tradeName: null, taxId: "04252011000110", email: null, phone: null, isCustomer: true, isSupplier: false, status: "active", addresses: [] as Record<string, unknown>[], contacts: [] as Record<string, unknown>[] })
let data = blank()
let canEdit = true
let refuse = false
const upstream = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json")
  expect(request.headers.authorization).toBe("Bearer complements-fixture-token")
  expect(request.headers["x-tenant-id"]).toBe(tenant)
  if (request.method === "PUT") {
    let body = ""; for await (const chunk of request) body += chunk
    expect(request.headers["if-match"]).toBe(`"${data.revision}"`)
    if (refuse) { response.writeHead(412); response.end(JSON.stringify({ title: "Revisão divergente" })); return }
    data = { ...JSON.parse(body), id, revision: data.revision + 1 }
  }
  response.setHeader("ETag", `"${data.revision}"`)
  response.end(JSON.stringify({ tenantId: tenant, canEdit, data }))
})
function cookie() {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  cipher.setAAD(Buffer.from("erp-session"))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "complements-fixture-token", tenantId: tenant, expiresAt: Date.now() + 3600_000 })), cipher.final()])
  return { name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" as const }
}
test.beforeAll(async () => { await new Promise<void>(resolve => upstream.listen(33119, "127.0.0.1", resolve)) })
test.afterAll(async () => { await new Promise<void>(resolve => upstream.close(() => resolve())) })
test.beforeEach(() => { data = blank(); canEdit = true; refuse = false })

test("party editor adds, reads and removes structured addresses and contacts without losing rejected edits", async ({ page, context }) => {
  await context.addCookies([cookie()])
  await page.goto(`/cadastros/clientes-fornecedores/${id}/editar`)
  await page.getByRole("button", { name: "Adicionar endereço", exact: true }).click()
  for (const [label, value] of [["Identificação", "Entrega"], ["CEP", "01001000"], ["UF", "SP"], ["Cidade", "São Paulo"], ["Rua", "Praça"], ["Número", "1"], ["Bairro", "Centro"]]) await page.getByLabel(`Endereço 1: ${label}`, { exact: true }).fill(value)
  await page.getByLabel("Endereço 1: Principal", { exact: true }).check()
  await page.getByRole("button", { name: "Adicionar contato", exact: true }).click()
  await page.getByLabel("Contato 1: Nome", { exact: true }).fill("Maria")
  await page.getByLabel("Contato 1: E-mail", { exact: true }).fill("maria@example.test")
  await page.getByRole("button", { name: "Salvar pessoa", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Pessoa salva" })).toBeVisible()
  expect(data.addresses[0].primary).toBe(true)
  expect(data.contacts[0].name).toBe("Maria")
  await page.goto(`/cadastros/clientes-fornecedores/${id}`)
  await expect(page.getByText("maria@example.test", { exact: true })).toBeVisible()
  await expect(page.getByText("Entrega · Principal", { exact: true })).toBeVisible()
  await page.getByRole("link", { name: "Editar pessoa", exact: true }).click()
  await page.getByLabel("Contato 1: Nome", { exact: true }).fill("Edição preservada")
  refuse = true
  await page.getByRole("button", { name: "Salvar pessoa", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Revisão divergente" })).toContainText("Revisão divergente")
  await expect(page.getByLabel("Contato 1: Nome", { exact: true })).toHaveValue("Edição preservada")
  refuse = false
  page.once("dialog", dialog => dialog.accept())
  await page.getByRole("button", { name: "Recarregar cadastro", exact: true }).click()
  await expect(page.getByLabel("Contato 1: Nome", { exact: true })).toHaveValue("Maria")
  await page.getByRole("button", { name: "Remover endereço 1", exact: true }).click()
  await page.getByRole("button", { name: "Remover contato 1", exact: true }).click()
  await page.getByRole("button", { name: "Salvar pessoa", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Pessoa salva" })).toBeVisible()
  expect(data.addresses).toEqual([]); expect(data.contacts).toEqual([])
  canEdit = false
  await page.goto(`/cadastros/clientes-fornecedores/${id}/editar`)
  await expect(page.getByRole("button", { name: "Adicionar endereço", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Adicionar contato", exact: true })).toBeDisabled()
})
