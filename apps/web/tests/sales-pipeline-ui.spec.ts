import { expect, test, type Page } from "@playwright/test"
import { installFrontendFixture, record, tenant } from "./helpers/frontend-fixture"

const other = "33333333-3333-4333-8333-333333333333"
const third = "44444444-4444-4444-8444-444444444444"
const opportunity = { id: record, revision: 1, title: "Renovação concluída", estimatedCents: 30003, stage: "won", customerId: null, customerName: null, companyName: "Academia Horizonte", companyTaxId: "", contactName: "Marina", phone: "", email: "", source: "Indicação", notes: "Conservar contexto", orderId: null, proposalId: null }
const rows = [
  { ...opportunity, id: other, stage: "new", estimatedCents: 10001, title: "Equipamentos para academia com área de musculação e preparação funcional", companyName: "Empresa com nome extenso para conferir a quebra de texto no celular" },
  opportunity,
  { ...opportunity, id: third, stage: "lost", title: "Projeto encerrado", estimatedCents: 40004 },
]
const totals = [{ stage: "new", count: 20, estimatedCents: 200020 }, { stage: "negotiation", count: 3, estimatedCents: 30000 }, { stage: "won", count: 4, estimatedCents: 120012 }, { stage: "lost", count: 2, estimatedCents: 80008 }]

async function fixture(page: Page, canEdit = true) {
  const queries: URLSearchParams[] = []
  const writes: { key: string | undefined; body: unknown }[] = []
  await page.route(/\/api\/erp\/opportunities\?/, route => {
    const query = new URL(route.request().url()).searchParams
    queries.push(query)
    return route.fulfill({ json: { tenantId: tenant, canEdit, total: query.get("q") === "ausente" ? 0 : query.get("stage") ? 26 : 3, totals, data: query.get("q") === "ausente" ? [] : query.get("stage") ? rows.filter(row => row.stage === query.get("stage")) : rows } })
  })
  await page.route(`**/api/erp/opportunities/${record}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit, data: opportunity } }))
  await page.route("**/api/erp/opportunities", route => {
    writes.push({ key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() })
    return route.fulfill({ status: 201, headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit, data: opportunity } })
  })
  return { queries, writes }
}

test("carregamento e erro do funil não aparecem como zero oportunidades", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  let release!: () => void
  const ready = new Promise<void>(resolve => { release = resolve })
  await page.route(/\/api\/erp\/opportunities\?/, async route => { await ready; await route.fulfill({ status: 503, json: { title: "Funil temporariamente indisponível" } }) })
  await page.goto("/vendas/funil")
  try {
    await expect(page.getByRole("status").filter({ hasText: "Carregando oportunidades" })).toBeVisible()
    await expect(page.getByText(/0 em andamento/)).toHaveCount(0)
  } finally { release() }
  await expect(page.getByRole("alert").filter({ hasText: "Funil temporariamente indisponível" })).toBeVisible()
  await expect(page.getByText(/0 em andamento/)).toHaveCount(0)
})

for (const width of [320, 390, 430, 1366, 1440]) test(`todas as etapas aparecem na lista compacta do funil em ${width}px`, async ({ context, page, baseURL }, info) => {
  await installFrontendFixture(context, baseURL)
  await fixture(page)
  await page.setViewportSize({ width, height: 900 })
  await page.goto("/vendas/funil")
  await expect(page.getByRole("link", { name: "Renovação concluída", exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Projeto encerrado", exact: true })).toBeVisible()
  const table = page.getByRole("table", { name: "Oportunidades do funil", exact: true })
  await expect(table.getByRole("row")).toHaveCount(4)
  await expect(table).toContainText("Ganho")
  await expect(table).toContainText("Perdido")
  const summary = page.locator("summary").filter({ hasText: "Resumo da empresa" })
  await expect(summary).toContainText("23 em andamento")
  await expect(summary).toContainText("R$ 2.300,20")
  await expect(summary.locator("..")).not.toHaveAttribute("open", "")
  const first = await table.getByRole("row").nth(1).boundingBox()
  expect(first!.y).toBeLessThan(630)
  if (width < 500) expect((await page.getByRole("button", { name: "Buscar", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`pipeline-${width}.png`), fullPage: true })
  await summary.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByText("Valores de todas as oportunidades da empresa, antes dos filtros.", { exact: true })).toBeVisible()
  await expect(summary.locator("..")).toContainText("R$ 1.200,12")
})

test("filtros e página do funil sobrevivem à consulta, retorno e Back/Forward", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  const state = await fixture(page)
  await page.goto("/vendas/funil?q=Horizonte&stage=won&offset=25")
  await expect(page.getByRole("combobox", { name: "Etapa", exact: true })).toHaveValue("won")
  await expect(page.getByLabel("Buscar oportunidade, empresa ou contato", { exact: true })).toHaveValue("Horizonte")
  await expect.poll(() => state.queries.at(-1)?.get("offset")).toBe("25")
  await page.getByRole("link", { name: opportunity.title, exact: true }).click()
  await expect(page.getByRole("link", { name: "Voltar ao funil", exact: true })).toHaveAttribute("href", "/vendas/funil?q=Horizonte&stage=won&offset=25")
  await page.getByRole("link", { name: "Voltar ao funil", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "Etapa", exact: true })).toHaveValue("won")
  await page.getByRole("button", { name: "Anterior", exact: true }).click()
  await expect.poll(() => state.queries.at(-1)?.get("offset")).toBe("0")
  await page.goBack()
  await expect.poll(() => state.queries.at(-1)?.get("offset")).toBe("25")
  await page.goForward()
  await expect.poll(() => state.queries.at(-1)?.get("offset")).toBe("0")
  expect(state.queries.at(-1)?.get("q")).toBe("Horizonte")
  expect(state.queries.at(-1)?.get("stage")).toBe("won")
})

test("revisão: sair da oportunidade editada pede confirmação e cancelar preserva os dados", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  await fixture(page)
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto(`/vendas/funil/${record}?returnTo=${encodeURIComponent("/vendas/funil?q=Horizonte&stage=won&offset=25")}`)
  const title = page.getByLabel("O que está sendo vendido", { exact: true })
  await title.fill("Negociação em revisão")
  let dialogs = 0
  page.on("dialog", dialog => { dialogs++; void dialog.dismiss() })
  await page.getByRole("link", { name: "Voltar ao funil", exact: true }).click()
  await expect.poll(() => dialogs).toBe(1)
  await expect(title).toHaveValue("Negociação em revisão")
  expect((await page.getByRole("link", { name: "Voltar ao funil", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
  expect((await page.getByRole("link", { name: "Avançar para simulação e pedido", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.getByRole("link", { name: "Avançar para simulação e pedido", exact: true }).click()
  await expect.poll(() => dialogs).toBe(2)
  await expect(title).toHaveValue("Negociação em revisão")
})

for (const width of [320, 1366]) test(`revisão: nomes completos e valores longos permanecem legíveis em ${width}px`, async ({ context, page, baseURL }, info) => {
  await installFrontendFixture(context, baseURL)
  const item = { ...opportunity, title: "Equipamentos completos para a nova unidade de musculação e preparação funcional da academia", companyName: "Academia Horizonte de Musculação e Preparação Física para Atletas e Alunos da Região", contactName: "Responsável pela implantação dos equipamentos e pelo acompanhamento da negociação comercial", estimatedCents: 99999999999999 }
  await page.route(/\/api\/erp\/opportunities\?/, route => route.fulfill({ json: { tenantId: tenant, canEdit: false, total: 1, totals: [{ stage: "won", count: 1, estimatedCents: item.estimatedCents }], data: [item] } }))
  await page.setViewportSize({ width, height: 900 })
  await page.goto("/vendas/funil")
  const table = page.getByRole("table", { name: "Oportunidades do funil", exact: true })
  for (const text of [item.title, item.companyName, item.contactName]) {
    const field = table.getByText(text, { exact: true }).filter({ visible: true })
    await expect(field).toBeVisible()
    expect(await field.evaluate(element => element.scrollHeight > element.clientHeight + 1)).toBe(false)
  }
  await expect(table).toContainText("R$ 999.999.999.999,99")
  if (width < 500) expect((await table.getByRole("link", { name: item.title, exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`pipeline-long-${width}.png`), fullPage: true })
})

test("revisão: página esvaziada oferece retorno direto sem perder filtros", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  const queries: URLSearchParams[] = []
  await page.route(/\/api\/erp\/opportunities\?/, route => {
    const query = new URL(route.request().url()).searchParams
    queries.push(query)
    return route.fulfill({ json: { tenantId: tenant, canEdit: false, total: 1, totals, data: query.get("offset") === "0" ? [opportunity] : [] } })
  })
  await page.goto("/vendas/funil?q=Horizonte&stage=won&offset=100000")
  await expect(page.getByText("Nenhuma oportunidade nesta página.", { exact: true })).toBeVisible()
  await expect(page.getByText(/Página 4001 de 1/)).toHaveCount(0)
  await page.getByRole("button", { name: "Voltar à primeira página", exact: true }).click()
  await expect(page.getByRole("link", { name: opportunity.title, exact: true })).toBeVisible()
  expect(queries.at(-1)?.get("offset")).toBe("0")
  expect(queries.at(-1)?.get("q")).toBe("Horizonte")
  expect(queries.at(-1)?.get("stage")).toBe("won")
})

test("revisão: alvo do título curto permite toque no celular", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  await fixture(page)
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto("/vendas/funil")
  const link = page.getByRole("link", { name: opportunity.title, exact: true })
  await expect(link).toBeVisible()
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
})

test("nova oportunidade salva conserva o retorno ao filtro de origem", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  const state = await fixture(page)
  await page.goto("/vendas/funil?q=Horizonte&stage=won&offset=25")
  await page.getByRole("link", { name: "Nova oportunidade", exact: true }).click()
  await page.getByLabel("O que está sendo vendido", { exact: true }).fill("Equipamentos da filial")
  await page.getByLabel("Empresa, se ainda não é cliente", { exact: true }).fill("Academia Horizonte")
  await page.getByRole("button", { name: "Criar oportunidade", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/vendas/funil/${record}\\?`))
  await expect(page.getByRole("link", { name: "Voltar ao funil", exact: true })).toHaveAttribute("href", "/vendas/funil?q=Horizonte&stage=won&offset=25")
  expect(state.writes).toHaveLength(1)
  expect(state.writes[0].key).toMatch(/^[a-f0-9-]{36}$/)
})

test("gravação incerta da oportunidade congela campos e repete o mesmo comando", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  await fixture(page)
  const requests: { key: string | undefined; body: string | null }[] = []
  await page.route("**/api/erp/opportunities", route => {
    requests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() })
    return route.fulfill({ status: 503, json: { title: "Resposta ainda não confirmada" } })
  })
  await page.goto(`/vendas/funil/nova?returnTo=${encodeURIComponent("/vendas/funil?q=Horizonte&stage=won&offset=25")}`)
  const title = page.getByLabel("O que está sendo vendido", { exact: true })
  await title.fill("Equipamentos da nova unidade")
  await page.getByLabel("Empresa, se ainda não é cliente", { exact: true }).fill("Academia Horizonte")
  await page.getByRole("button", { name: "Criar oportunidade", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Resposta ainda não confirmada" })).toBeVisible()
  await expect(title).toBeDisabled()
  let dialogs = 0
  page.on("dialog", dialog => { dialogs++; void dialog.dismiss() })
  await page.getByRole("link", { name: "Voltar ao funil", exact: true }).click()
  await expect.poll(() => dialogs).toBe(1)
  await expect(title).toHaveValue("Equipamentos da nova unidade")
  await page.getByRole("button", { name: "Conferir gravação com o mesmo comando", exact: true }).click()
  await expect.poll(() => requests.length).toBe(2)
  expect(requests[0].key).toMatch(/^[a-f0-9-]{36}$/)
  expect(requests[1]).toEqual(requests[0])
})

test("consulta repetida, erro, vazio e limpeza conservam filtros e permissões", async ({ context, page, baseURL }) => {
  await installFrontendFixture(context, baseURL)
  const state = await fixture(page, false)
  await page.goto("/vendas/funil?q=ausente&stage=lost")
  await expect(page.getByText("Nenhum resultado encontrado", { exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Nova oportunidade", exact: true })).toHaveCount(0)
  const calls = state.queries.length
  await page.getByRole("button", { name: "Buscar", exact: true }).click()
  await expect.poll(() => state.queries.length).toBeGreaterThan(calls)
  let attempts = 0
  await page.route(/\/api\/erp\/opportunities\?/, route => {
    attempts++
    state.queries.push(new URL(route.request().url()).searchParams)
    return route.fulfill(attempts === 1 ? { status: 503, json: { title: "Falha temporária no funil" } } : { json: { tenantId: tenant, canEdit: false, data: [], total: 0, totals } })
  })
  await page.getByRole("button", { name: "Buscar", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Falha temporária" })).toBeVisible()
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click()
  await expect(page.getByText("Nenhum resultado encontrado", { exact: true })).toBeVisible()
  expect(state.queries.at(-1)?.get("q")).toBe("ausente")
  expect(state.queries.at(-1)?.get("stage")).toBe("lost")
  await page.getByRole("button", { name: "Limpar", exact: true }).click()
  await expect(page).toHaveURL(/\/vendas\/funil$/)
  expect(state.writes).toHaveLength(0)
})
