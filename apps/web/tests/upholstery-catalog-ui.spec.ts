import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

const productId = "33333333-3333-4333-8333-333333333333"
const customerId = "44444444-4444-4444-8444-444444444444"
const name = "HammerForce Pro · Desenvolvimento de ombros articulado"
const proposal = { id: record, number: "1", version: 1, revision: 1, customerId, customerName: "Academia de teste", customerTaxId: "52998224725", validUntil: "2100-01-01", paymentTerms: "À vista", deliveryTerms: "Retirada", notes: "", amount: "200.00", status: "draft", expired: false, orderId: null, isCurrent: true, createdAt: "2026-11-11", sentAt: null, decidedAt: null, decidedBy: null, decisionReason: null }
const item = { productId, name, sku: "HF-101", unit: "UN", quantity: "1.000000", unitPrice: "200.00", catalogPrice: "200.00", amount: "200.00", structureColor: "Titanium Grey", upholsteryColor: "Preto", plateHolderType: null, plateHolderColor: null }
const finishes = [
  { label: "Braços", structureColors: ["Piano Black", "Titanium Grey", "Graphite Black"], structureColor: "Titanium Grey", colors: ["Preto", "Grafite", "Cinza", "Vermelho", "Laranja", "Amarelo", "Azul"], initial: "Preto", selected: "Grafite", photoCount: 6 },
  { label: "Estofado", structureColors: ["Preto"], structureColor: "Preto", colors: ["Black", "Saddle Brown", "Reddish Brown", "Mocha"], initial: "Black", selected: "Mocha", photoCount: 4 },
]

for (const finish of finishes) for (const width of [320, 390]) test(`proposta mostra fotos de ${finish.label.toLowerCase()} do catálogo e conserva a escolha em ${width}px`, async ({ context, page }, info) => {
  await installFrontendFixture(context)
  await page.setViewportSize({ width, height: 844 })
  await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["sales.proposals.read", "sales.proposals.manage"] } }))
  let saved: Record<string, unknown> | undefined
  await page.route(`**/api/erp/proposals/${record}`, route => {
    if (route.request().method() === "PUT") saved = route.request().postDataJSON()
    return route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: proposal, items: [{ ...item, structureColor: finish.structureColor, upholsteryColor: saved ? finish.selected : finish.initial }], versions: [proposal] } })
  })
  await page.route(`**/api/erp/products/${productId}`, route => route.fulfill({ json: { tenantId: tenant, data: { id: productId, structureColors: finish.structureColors, upholsteryColors: finish.colors, plateHolderColors: [], plateHolderTypes: [], hasPhoto: false } } }))
  await page.goto(`/vendas/propostas/${record}/editar`)
  const finishes = page.getByRole("region", { name: `Item da proposta: ${name}`, exact: true }).locator("details")
  await expect(finishes).not.toHaveAttribute("open", "")
  await finishes.locator("summary").click()
  const color = page.getByLabel(`${finish.label} de ${name}`, { exact: true })
  const photos = page.getByRole("group", { name: `${finish.label} de ${name}: fotos do catálogo DHZ`, exact: true })
  await expect(color).toHaveValue(finish.initial)
  await expect(photos.getByRole("button")).toHaveCount(finish.photoCount)
  await expect(photos.getByRole("button", { name: finish.selected, exact: true })).toBeVisible()
  await photos.getByRole("button", { name: finish.selected, exact: true }).click()
  await expect(color).toHaveValue(finish.selected)
  await expect(photos.getByRole("button", { name: finish.selected, exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(photos.getByRole("button", { name: finish.initial, exact: true })).toHaveAttribute("aria-pressed", "false")
  await expect(photos.locator("[style*='background-image']").first()).toHaveCSS("background-image", /dhz-hammerforce-pro-original-colors\.jpeg/)
  if (finish.label === "Braços") {
    await expect(color.getByRole("option", { name: "Amarelo", exact: true })).toHaveCount(1)
    await expect(photos.getByRole("button", { name: "Amarelo", exact: true })).toHaveCount(0)
  }
  expect((await photos.getByRole("button", { name: finish.selected, exact: true }).boundingBox())!.width).toBeLessThanOrEqual(80)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`proposal-catalog-finishes-${finish.label}-${width}.png`) })
  await finishes.locator("summary").click()
  await expect(finishes.locator("summary")).toContainText(finish.selected)
  await page.getByRole("button", { name: "Salvar proposta", exact: true }).click()
  await expect.poll(() => saved).toMatchObject({ items: [{ productId, structureColor: finish.structureColor, upholsteryColor: finish.selected, unitPrice: "200.00" }] })
})
