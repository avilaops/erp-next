import { expect, test } from "@playwright/test"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { normalizeDecimal } from "../src/lib/decimal-input"
import { fixedValue } from "../src/features/purchasing/purchase-types"
import { isDemonstrationRoute, demonstrationRoutes } from "../src/lib/demonstration-routes"

test("decimais preservam precisão e rejeitam agrupamento, arredondamento e excesso", () => {
  for (const [input, expected] of [["12,50", "12.50"], ["12.50", "12.50"], ["12", "12.00"], ["0,1", "0.10"], ["999999999999,99", "999999999999.99"]]) {
    expect(normalizeDecimal(input)).toBe(expected)
  }
  for (const input of ["1.234,56", "1,234.56", "12,345", "12.345", "-1", "1e3", "NaN", "Infinity", "01,50", "1000000000000", ""]) expect(normalizeDecimal(input)).toBeNull()
  expect(normalizeDecimal("999999999999,999999", 6)).toBe("999999999999.999999")
  expect(normalizeDecimal("0,0000001", 6)).toBeNull()
  expect(fixedValue("999999999999,999999", 6)).toBe(BigInt("999999999999999999"))
})

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)])
}

test("inventário de páginas exige título e preserva rotas operacionais nas prévias", () => {
  const root = path.resolve("src/app")
  const pages = files(root).filter(file => file.endsWith(path.sep + "page.tsx"))
  expect(pages.length).toBeGreaterThanOrEqual(177)
  for (const file of pages) {
    const source = readFileSync(file, "utf8")
    expect(source, file).toMatch(/export (?:const metadata = \{ title: ".+" \}|async function generateMetadata)/)
    if (/import \{ (?:CatalogAccess|ReferenceAccess|PurchaseAccess|OperationsAccess|StaffAccess|PartyAccess|ContractsAccess|StockAccess|ServiceKeys) \}/.test(source)) {
      const route = "/" + path.relative(root, path.dirname(file)).split(path.sep).join("/").replace("[id]", "22222222-2222-4222-8222-222222222222")
      expect(isDemonstrationRoute(route), route).toBe(false)
    }
  }
  for (const route of demonstrationRoutes) expect(isDemonstrationRoute(route.replace(/\[[^\]]+\]/g, "exemplo")), route).toBe(true)
  expect(isDemonstrationRoute("/preferencias/integracoes/lojas")).toBe(false)
  expect(isDemonstrationRoute("/estoque/lancamentos/novo")).toBe(false)
  expect(isDemonstrationRoute("/fiscal/notas-saida")).toBe(false)
})
