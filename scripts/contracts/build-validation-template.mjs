import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = fileURLToPath(new URL("../../", import.meta.url))
const requireWeb = createRequire(path.join(root, "apps/web/package.json"))
const { chromium } = requireWeb("@playwright/test")
const output = path.join(root, "artifacts/contract-validation")
const uuid = name => {
  const hex = createHash("sha256").update(`avilaops-contract-validation-v1:${name}`).digest("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
const browser = await chromium.launch({ channel: process.env.ERP_BROWSER_CHANNEL || "chrome" })
try {
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 })
  await page.setContent(await readFile(path.join(root, "deploy/contracts-portal/templates/validation.html"), "utf8"))
  await page.emulateMedia({ media: "print" })
  await page.evaluate(() => document.fonts.ready)
  const areas = await page.locator("[data-field]").evaluateAll(elements => {
    const sheet = document.querySelector(".page").getBoundingClientRect()
    return elements.map(element => {
      const rect = element.getBoundingClientRect()
      return { name: element.dataset.field, type: element.dataset.type || "text", required: element.dataset.required === "true", areas: [{ x: (rect.x - sheet.x) / sheet.width, y: (rect.y - sheet.y) / sheet.height, w: rect.width / sheet.width, h: rect.height / sheet.height, page: 0 }] }
    })
  })
  if (areas.length !== 11 || new Set(areas.map(field => field.name)).size !== areas.length) throw new Error("Invalid validation fields")
  for (const field of areas) for (const area of field.areas) {
    if (area.x < 0 || area.y < 0 || area.w <= 0 || area.h <= 0 || area.x + area.w > 1 || area.y + area.h > 1) throw new Error("Field outside page")
  }
  await mkdir(output, { recursive: true })
  const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true })
  await writeFile(path.join(output, "validation.pdf"), pdf)
  await page.screenshot({ path: path.join(output, "validation.png"), fullPage: true })
  const role = uuid("signer")
  const manifest = {
    name: "Validação técnica Ávila Ops — SEM VALOR COMERCIAL",
    external_id: "avilaops-erp-validation-v1",
    sha256: createHash("sha256").update(pdf).digest("hex"),
    submitters: [{ name: "Participante de validação", uuid: role }],
    fields: areas.map(field => ({ ...field, uuid: uuid(field.name), submitter_uuid: role, preferences: { font_size: field.name === "itens" ? 9 : 10 } })),
  }
  await writeFile(path.join(output, "validation.json"), JSON.stringify(manifest, null, 2) + "\n")
  console.log(`Validation template: ${areas.length} fields, PDF SHA-256 ${manifest.sha256}`)
} finally {
  await browser.close()
}
