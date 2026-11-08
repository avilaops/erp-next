import { expect, test, type Page } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

// Synthetic server responses exercise the editor; these are not an authorized IBPT table.
const item = { code: "P1", description: "Produto", unit: "UN", ncm: "95069100", cfop: "5102", quantity: "1.0000", unitPrice: "100.0000000000", grossTotal: "100.00", origin: 0, csosn: null, icmsCst: "00", pisCst: "01", cofinsCst: "01" }
const legacy = { environment: "homologation", model: 55, operationNature: "Venda", taxRuleReference: "Instrução do responsável fiscal", recipient: { taxId: "11222333000181", legalName: "Cliente de teste", state: "SP", municipalityCode: "3549805", postalCode: "15035000", street: "Rua Teste", number: "1", district: "Centro" }, items: [item], productsTotal: "100.00", payments: [{ code: "17", amount: "100.00", description: null }] }
const selection = { uf: "SP", asOf: "2026-11-03", items: [{ ex: "0", origin: "national", version: "26.2.A" }] }
const amounts = { federal: "10.00", state: "18.00", municipal: "0.00", total: "28.00" }
const savedEstimate = { tenantId: tenant, uf: "SP", asOf: "2026-11-03", items: [{ itemCode: "P1", code: "95069100", ex: "0", origin: "national", amount: "100.00", metadata: { uf: "SP", classification: "ncm", version: "26.2.A", source: "Fixture sintética de teste", key: "synthetic-key", validFrom: "2026-11-01", validTo: "2026-11-30", sha256: "a".repeat(64) }, amounts }], amounts }

test.beforeEach(async ({ context }) => installFrontendFixture(context))

async function setup(page: Page, options: { existing?: boolean; readOnly?: boolean; reject?: boolean; twoItems?: boolean; delaySave?: Promise<void> } = {}) {
  let saved: Record<string, unknown> | undefined
  const initial = { ...legacy, ...(options.twoItems ? { items: [item, { ...item, code: "P2", description: "Segundo produto" }] } : {}), ...(options.existing ? { ibpt: selection } : {}) }
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["fiscal.nfe.read", ...(!options.readOnly ? ["fiscal.nfe.manage"] : [])] } }))
  await page.route("**/api/erp/fiscal/readiness", route => route.fulfill({ json: { tenantId: tenant, profileConfigured: true, certificateVerified: false, canTransmit: false, productionEnabled: false, blockers: [] } }))
  await page.route(`**/api/erp/fiscal/nfe/${record}/emission`, route => route.fulfill({ status: 404, json: { title: "Sem emissão" } }))
  await page.route(`**/api/erp/fiscal/nfe/${record}`, async route => {
    if (route.request().method() === "PUT") {
      saved = route.request().postDataJSON()
      if (options.reject && saved?.ibpt) return route.fulfill({ status: 409, json: { code: "ibpt_not_available", title: "Tabela IBPT não configurada para UF, data e versão solicitadas" } })
      await options.delaySave
    }
    const input = saved || initial
    return route.fulfill({ headers: { ETag: saved ? '"2"' : '"1"' }, json: { tenantId: tenant, canEdit: !options.readOnly, data: { id: record, revision: saved ? 2 : 1, status: "draft", input, issuer: { legalName: "Empresa teste", profile: { crt: 3 } }, ...((saved ? saved.ibpt : options.existing) ? { ibptSnapshot: savedEstimate } : {}) } } })
  })
  await page.goto(`/fiscal/notas-saida/${record}`)
  await expect(page.getByLabel("Natureza da operação", { exact: true })).toHaveValue("Venda")
  return () => saved
}

async function showIbpt(page: Page) {
  await page.getByRole("button", { name: "4. Tributação", exact: true }).click()
  const section = page.locator("details").filter({ has: page.locator("summary", { hasText: "Estimativa IBPT" }) })
  if (await section.getAttribute("open") === null) await section.locator("summary").click()
}

async function saveDraft(page: Page) {
  await page.getByRole("button", { name: "6. Revisão e emissão", exact: true }).click()
  await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click()
}

async function choose(page: Page) {
  await showIbpt(page)
  await page.getByRole("button", { name: "Adicionar estimativa IBPT", exact: true }).click()
  await page.getByLabel("UF da estimativa IBPT", { exact: true }).selectOption("SP")
  await page.getByLabel("Data de referência IBPT", { exact: true }).fill("2026-11-03")
  await page.getByLabel("EX IBPT do item 1", { exact: true }).fill("0")
  await page.getByLabel("Origem IBPT do item 1", { exact: true }).selectOption("national")
  await page.getByLabel("Versão IBPT do item 1 (opcional)", { exact: true }).fill("26.2.A")
}

test("IBPT exige adesão e escolhas explícitas sem inferir UF, data, EX ou origem", async ({ page }) => {
  const saved = await setup(page)
  await showIbpt(page)
  await expect(page.getByLabel("UF da estimativa IBPT", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Adicionar estimativa IBPT", exact: true }).click()
  for (const label of ["UF da estimativa IBPT", "Data de referência IBPT", "EX IBPT do item 1", "Origem IBPT do item 1", "Versão IBPT do item 1 (opcional)"]) await expect(page.getByLabel(label, { exact: true })).toHaveValue("")
  await saveDraft(page)
  expect(saved()).toBeUndefined()
  await expect(page.getByRole("region", { name: "Estimativa IBPT da revisão salva", exact: true })).toHaveCount(0)
  await page.getByLabel("UF da estimativa IBPT", { exact: true }).selectOption("SP")
  await page.getByLabel("Data de referência IBPT", { exact: true }).fill("2026-11-03")
  await page.getByLabel("EX IBPT do item 1", { exact: true }).fill("0")
  await saveDraft(page)
  await expect(page.getByRole("alert").filter({ hasText: "Confira o campo indicado antes de salvar o rascunho." })).toBeVisible()
  await expect(page.getByLabel("Origem IBPT do item 1", { exact: true })).toBeFocused()
  expect(saved()).toBeUndefined()
  await page.getByLabel("Origem IBPT do item 1", { exact: true }).selectOption("national")
  await page.getByLabel("Versão IBPT do item 1 (opcional)", { exact: true }).fill("errada")
  await saveDraft(page)
  await expect(page.getByRole("alert").filter({ hasText: "Confira o campo indicado antes de salvar o rascunho." })).toBeVisible()
  await expect(page.getByLabel("Versão IBPT do item 1 (opcional)", { exact: true })).toBeFocused()
  expect(saved()).toBeUndefined()
})

test("IBPT permanece ausente ao salvar rascunho legado sem adesão", async ({ page }) => {
  const saved = await setup(page)
  await page.getByRole("button", { name: "1. Dados da nota", exact: true }).click()
  await page.getByLabel("Natureza da operação", { exact: true }).fill("Venda revisada")
  await saveDraft(page)
  await expect(page.getByText("Rascunho salvo no servidor. Nenhuma nota foi transmitida.", { exact: true })).toBeVisible()
  expect(saved()).not.toHaveProperty("ibpt")
  expect(saved()).not.toHaveProperty("ibptSnapshot")
})

test("IBPT com versão em branco deixa a escolha da versão válida ao servidor", async ({ page }) => {
  const saved = await setup(page)
  await choose(page)
  await page.getByLabel("Versão IBPT do item 1 (opcional)", { exact: true }).fill("")
  await saveDraft(page)
  await expect(page.getByText("Rascunho salvo no servidor. Nenhuma nota foi transmitida.", { exact: true })).toBeVisible()
  expect(saved()?.ibpt).toEqual({ uf: "SP", asOf: "2026-11-03", items: [{ ex: "0", origin: "national", version: null }] })
  await expect(page.getByRole("region", { name: "Estimativa IBPT da revisão salva", exact: true }).getByText("26.2.A", { exact: true })).toBeVisible()
})

test("IBPT envia escolhas sem snapshot e mostra valores somente após confirmação da gravação", async ({ page }) => {
  let release!: () => void
  const confirmation = new Promise<void>(resolve => { release = resolve })
  const saved = await setup(page, { delaySave: confirmation })
  await choose(page)
  await expect(page.getByText("Total estimado IBPT: R$ 28,00", { exact: true })).toHaveCount(0)
  await saveDraft(page)
  await expect.poll(() => saved()?.ibpt).toEqual(selection)
  expect(saved()).not.toHaveProperty("ibptSnapshot")
  expect(saved()?.payments).toEqual(legacy.payments)
  await expect(page.getByText("Total estimado IBPT: R$ 28,00", { exact: true })).toHaveCount(0)
  release()
  await expect(page.getByText("Total estimado IBPT: R$ 28,00", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "1. Dados da nota", exact: true }).click()
  await page.getByLabel("Natureza da operação", { exact: true }).fill("Venda alterada")
  await page.getByRole("button", { name: "6. Revisão e emissão", exact: true }).click()
  await expect(page.getByText("Há alterações não salvas. A estimativa exibida pertence à revisão salva.", { exact: true })).toBeVisible()
  await showIbpt(page)
  await page.getByRole("button", { name: "Remover estimativa IBPT", exact: true }).click()
  await saveDraft(page)
  await expect(page.getByRole("region", { name: "Estimativa IBPT da revisão salva", exact: true })).toHaveCount(0)
  expect(saved()?.ibpt).toBeNull()
})

test("IBPT indisponível conserva edição e não apresenta estimativa zero", async ({ page }) => {
  await setup(page, { reject: true })
  await choose(page)
  await page.getByRole("button", { name: "1. Dados da nota", exact: true }).click()
  await page.getByLabel("Natureza da operação", { exact: true }).fill("Venda preservada")
  await saveDraft(page)
  await expect(page.getByRole("alert").filter({ hasText: "Tabela IBPT não configurada" })).toBeVisible()
  await expect(page.getByLabel("Natureza da operação", { exact: true })).toHaveValue("Venda preservada")
  await expect(page.getByLabel("EX IBPT do item 1", { exact: true })).toHaveValue("0")
  await expect(page.getByRole("region", { name: "Estimativa IBPT da revisão salva", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "1. Dados da nota", exact: true }).click()
  await expect(page.getByLabel("Natureza da operação", { exact: true })).toBeEditable()
  await showIbpt(page)
  await page.getByRole("button", { name: "Remover estimativa IBPT", exact: true }).click()
  await saveDraft(page)
  await expect(page.getByText("Rascunho salvo no servidor. Nenhuma nota foi transmitida.", { exact: true })).toBeVisible()
})

test("IBPT mantém escolhas associadas ao remover item e exige nova escolha ao adicionar", async ({ page }) => {
  await setup(page, { twoItems: true })
  await choose(page)
  await page.getByLabel("EX IBPT do item 2", { exact: true }).fill("12")
  await page.getByLabel("Origem IBPT do item 2", { exact: true }).selectOption("imported")
  await page.getByRole("button", { name: "3. Produtos", exact: true }).click()
  await page.getByRole("button", { name: "Remover item 1", exact: true }).click()
  await expect(page.getByLabel("Código do produto", { exact: true })).toHaveValue("P2")
  await showIbpt(page)
  await expect(page.getByLabel("EX IBPT do item 1", { exact: true })).toHaveValue("12")
  await expect(page.getByLabel("Origem IBPT do item 1", { exact: true })).toHaveValue("imported")
  await page.getByRole("button", { name: "3. Produtos", exact: true }).click()
  await page.getByRole("button", { name: "Adicionar item manualmente", exact: true }).click()
  await showIbpt(page)
  await expect(page.getByLabel("EX IBPT do item 2", { exact: true })).toHaveValue("")
  await expect(page.getByLabel("Origem IBPT do item 2", { exact: true })).toHaveValue("")
})

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 900 }, { width: 1920, height: 1080 }]) {
  test(`IBPT revisão salva consultável sem edição e sem overflow em ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await setup(page, { existing: true, readOnly: true })
    const estimate = page.getByRole("region", { name: "Estimativa IBPT da revisão salva", exact: true })
    await expect(estimate).toBeVisible()
    for (const text of ["Fixture sintética de teste", "26.2.A", "synthetic-key", "a".repeat(64), "2026-11-01", "2026-11-30"]) await expect(estimate.getByText(text, { exact: false })).toBeVisible()
    await expect(estimate.getByText("Federal: R$ 10,00", { exact: true }).first()).toBeVisible()
    await expect(estimate.getByText("Estadual: R$ 18,00", { exact: true }).first()).toBeVisible()
    await expect(estimate.getByText("Municipal: R$ 0,00", { exact: true }).first()).toBeVisible()
    await expect(estimate.getByText("Total estimado IBPT: R$ 28,00", { exact: true })).toBeVisible()
    await showIbpt(page)
    await expect(page.getByLabel("UF da estimativa IBPT", { exact: true })).toBeDisabled()
    await expect(page.getByRole("button", { name: "Remover estimativa IBPT", exact: true })).toBeDisabled()
    await page.getByRole("button", { name: "6. Revisão e emissão", exact: true }).click()
    const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll("main *")].filter(element => element.getBoundingClientRect().right > innerWidth + 1).map(element => ({ tag: element.tagName, text: element.textContent?.slice(0, 80), className: element.className, right: element.getBoundingClientRect().right })) }))
    expect(layout.scrollWidth, JSON.stringify(layout)).toBeLessThanOrEqual(layout.width)
    await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" })
    const violations = await page.evaluate(async () => (await (window as unknown as { axe: { run: (target: string, options: unknown) => Promise<{ violations: unknown[] }> } }).axe.run("[aria-label='Estimativa IBPT da revisão salva']", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations)
    expect(violations).toEqual([])
  })
}
