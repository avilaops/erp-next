import { expect, test } from "@playwright/test"
import { createServer } from "node:http"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

const order = { id: record, customerName: "Cliente da pesquisa", customerTaxId: "52998224725", dueDate: "2026-12-30", amount: "199128.86", status: "draft" }

test.beforeEach(async ({ context }) => { await installFrontendFixture(context) })

test("pedidos usam tabela e pesquisa no servidor, preservando filtro ao paginar", async ({ page }, info) => {
  const requests: URLSearchParams[] = []
  await page.route(/\/api\/erp\/orders\?/, route => {
    const query = new URL(route.request().url()).searchParams
    requests.push(query)
    return route.fulfill({ json: { tenantId: tenant, canEdit: true, total: query.get("q") === "ausente" ? 0 : 26, data: query.get("q") === "ausente" ? [] : [order] } })
  })
  await page.goto("/vendas/pedidos")
  const table = page.getByRole("table", { name: "Pedidos de venda" })
  await expect(table.getByRole("columnheader")).toHaveText(["Cliente", "Situação", "Vencimento", "Valor"])
  await expect(table.getByRole("link", { name: order.customerName, exact: true })).toHaveAttribute("href", `/vendas/pedidos/${record}`)
  await expect(table).not.toContainText("Pedido de ")
  await expect(table).toContainText("199.128,86")
  await expect(table).toContainText("30/12/2026")
  await page.getByLabel("Buscar pedidos", { exact: true }).fill("  Cliente  ")
  await page.getByRole("button", { name: "Pesquisar", exact: true }).click()
  await expect.poll(() => requests.at(-1)?.get("q")).toBe("Cliente")
  await page.getByRole("button", { name: "Próxima", exact: true }).click()
  await expect.poll(() => requests.at(-1)?.get("offset")).toBe("25")
  expect(requests.at(-1)?.get("q")).toBe("Cliente")
  await page.getByLabel("Buscar pedidos", { exact: true }).fill("ausente")
  await page.getByRole("button", { name: "Pesquisar", exact: true }).click()
  await expect(page.getByText("Nenhum pedido encontrado para esta pesquisa.")).toBeVisible()
  expect(requests.at(-1)?.get("offset")).toBe("0")
  await page.getByRole("button", { name: "Limpar", exact: true }).click()
  await expect(table).toBeVisible()
  expect(requests.at(-1)?.get("q")).toBeNull()
  await page.emulateMedia({ colorScheme: "dark" })
  await page.screenshot({ path: info.outputPath("orders-desktop.png"), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath("orders-mobile.png"), fullPage: true })
})

test("falha de pesquisa mantém os filtros e permite repetir em modo de consulta", async ({ page }) => {
  let failing = false
  await page.route(/\/api\/erp\/orders\?/, route => route.fulfill(failing ? { status: 503, json: { title: "Consulta temporariamente indisponível" } } : { json: { tenantId: tenant, canEdit: false, total: 1, data: [order] } }))
  await page.goto("/vendas/pedidos")
  await expect(page.getByRole("table")).toBeVisible()
  await expect(page.getByRole("link", { name: "Novo pedido", exact: true })).toHaveCount(0)
  failing = true
  await page.getByLabel("Buscar pedidos", { exact: true }).fill("Cliente")
  await page.getByRole("button", { name: "Pesquisar", exact: true }).click()
  await expect(page.locator("main").getByRole("alert")).toContainText("Consulta temporariamente indisponível")
  await expect(page.getByLabel("Buscar pedidos", { exact: true })).toHaveValue("Cliente")
  failing = false
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click()
  await expect(page.getByRole("table")).toBeVisible()
})

test("BFF encaminha pesquisa e paginação e rejeita filtros desconhecidos ou duplicados", async ({ context }) => {
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(request.url || "")
    response.writeHead(200, { "Content-Type": "application/json" })
    response.end(JSON.stringify({ tenantId: tenant, canEdit: false, data: [], total: 0 }))
  })
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(33119, "127.0.0.1", resolve) })
  try {
    const response = await context.request.get("/api/erp/orders?q=Cliente%20%26%20Filhos&offset=25&limit=25")
    expect(response.status()).toBe(200)
    expect(requests).toEqual(["/api/v1/orders?q=Cliente+%26+Filhos&offset=25&limit=25"])
    for (const query of ["q=a&q=b", "unknown=1"]) expect((await context.request.get(`/api/erp/orders?${query}`)).status()).toBe(400)
    expect(requests).toHaveLength(1)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
