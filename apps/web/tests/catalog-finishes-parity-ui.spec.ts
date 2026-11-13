import { expect, test } from "@playwright/test"
import { installFrontendFixture, tenant, record } from "./helpers/frontend-fixture"

test.beforeEach(async ({ context }) => installFrontendFixture(context))

for (const [width, fixed] of [[320, false], [393, false], [1280, false], [393, true]] as const) test(`catálogo separa estrutura, braços e estofado reais em ${width}px${fixed ? " com estofado fixo" : ""}`, async ({ page }, info) => {
 await page.setViewportSize({ width, height: 1000 })
 const writes: string[] = []
 page.on("request", request => { if (request.method() !== "GET" && /\/api\/erp\//.test(request.url())) writes.push(request.url()) })
 await page.route("**/api/erp/me", route => route.fulfill({ json: { tenant: { id: tenant }, permissions: ["catalog.products.read", "catalog.products.manage"] } }))
 await page.route(/\/api\/erp\/product-categories\?/, route => route.fulfill({ json: { tenantId: tenant, canEdit: true, total: 0, data: [] } }))
 await page.route(`**/api/erp/products/${record}/catalog`, route => route.fulfill({ json: { tenantId: tenant, productId: record, canEdit: true, data: null, assets: [], mediaConfigured: false } }))
 await page.route(`**/api/erp/products/${record}`, route => route.fulfill({ headers: { ETag: '"1"' }, json: { tenantId: tenant, canEdit: true, data: {
  id: record, revision: 1, sku: "LD-TEST", name: "Equipamento com três acabamentos", unit: "UN", basePrice: "100.00", ncm: "95069100", cest: null, status: "active", categoryId: null,
  hasPhoto: false, photoUrl: null, finishingPalette: "dhz-hammerforce-pro", structureColors: ["Piano Black", "Matte Graphite Black", "Light Grey", "Performance Red"],
  swingArmColors: ["Piano Black", "Matte Graphite Black", "Light Grey", "Performance Red", "Hermès Orange", "Apple Green"],
  upholsteryColors: ["Black", "Saddle Brown", "Reddish Brown", "Mocha"], upholsteryConfigurable: !fixed, plateHolderTypes: ["Standard", "Olímpico"], plateHolderColors: [],
 } } }))
 await page.goto(`/cadastros/produtos/${record}`)
 await page.getByText("Acabamentos disponíveis", { exact: true }).click()
 const arms = page.getByRole("group", { name: "Braços: fotos do catálogo DHZ", exact: true })
 const upholstery = page.getByRole("group", { name: "Estofado: fotos do catálogo DHZ", exact: true })
 await expect(arms.getByText("Apple Green", { exact: true })).toBeVisible()
 await expect(arms.getByText("Hermès Orange", { exact: true })).toBeVisible()
 if (fixed) {
  await expect(upholstery).toHaveCount(0)
  await expect(page.getByText("Estofado padrão", { exact: true })).toBeVisible()
 } else {
  await expect(upholstery.getByText("Saddle Brown", { exact: true })).toBeVisible()
  await expect(upholstery.getByText("Reddish Brown", { exact: true })).toBeVisible()
  await expect(upholstery.getByText("Mocha", { exact: true })).toBeVisible()
  await expect(upholstery.getByText("Apple Green", { exact: true })).toHaveCount(0)
 }
 await expect(page.getByText(/Cor(?:es)? d[oa]s? anilheiros?/i)).toHaveCount(0)
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
 expect(writes).toEqual([])
 await page.screenshot({ path: info.outputPath(`catalog-three-finishes-${width}.png`), fullPage: true })
})
