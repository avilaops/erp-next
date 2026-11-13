import assert from "node:assert/strict"
import { test } from "node:test"
import { getCatalogFinishPalette, catalogFinishGroups } from "../src/features/catalog/catalog-finish-palettes.ts"

test("Pro keeps standard paint, signature paint and leather upholstery separate", () => {
 const pro = getCatalogFinishPalette("dhz-hammerforce-pro")
 assert.deepEqual(pro.structure.standard, ["Piano Black", "Matte Graphite Black", "Light Grey", "Performance Red"])
 assert.deepEqual(pro.structure.special, ["Titanium Grey"])
 assert.deepEqual(pro.swingArm.standard, ["Piano Black", "Matte Graphite Black", "Light Grey", "Performance Red", "Hermès Orange", "Apple Green"])
 assert.deepEqual(pro.swingArm.special, ["Titanium Grey", "Ocean Blue"])
 assert.deepEqual(pro.upholstery.standard, ["Black", "Saddle Brown", "Reddish Brown", "Mocha"])
 assert.deepEqual(pro.upholstery.special, [])
 assert.equal(pro.source.pdfPage, 51)
 assert.equal(pro.source.printedPage, 101)
})

test("SForce follows its own page, including Khaki upholstery and signature Titanium arms", () => {
 const sf = getCatalogFinishPalette("dhz-sforce")
 assert.deepEqual(sf.structure.standard, ["Piano Black", "Graphite Black", "Light Grey", "Performance Red", "Titanium Grey"])
 assert.deepEqual(sf.swingArm.standard, ["Piano Black", "Graphite Black", "Light Grey", "Performance Red", "Hermès Orange", "Apple Green", "Ocean Blue"])
 assert.deepEqual(sf.swingArm.special, ["Titanium Grey"])
 assert.deepEqual(sf.upholstery.standard, ["Black", "Saddle Brown", "Reddish Brown", "Khaki", "Mocha"])
 assert.notEqual(sf.source.asset, getCatalogFinishPalette("dhz-hammerforce-pro").source.asset)
 assert.equal(sf.source.pdfPage, 29)
})

test("unknown palettes and names are preserved as text rather than assigned another material", () => {
 for (const name of [undefined, null, "", "Cable Motion", "Preto", "dhz-hammerforce"]) assert.equal(getCatalogFinishPalette(name), undefined)
 const options = ["Piano Black", "Titanium Grey", "Amarelo", "Preto", "Ocean Blue"]
 assert.deepEqual(catalogFinishGroups("dhz-hammerforce-pro", "swingArm", options), {
  standard: ["Piano Black"], special: ["Titanium Grey", "Ocean Blue"], other: ["Amarelo", "Preto"],
 })
 assert.deepEqual(catalogFinishGroups(undefined, "upholstery", options), { standard: [], special: [], other: options })
 assert.deepEqual(options, ["Piano Black", "Titanium Grey", "Amarelo", "Preto", "Ocean Blue"])
})

test("paint names do not enter upholstery and a shortened graphite label keeps its original text", () => {
 assert.deepEqual(catalogFinishGroups("dhz-hammerforce-pro", "upholstery", ["Black", "Saddle Brown", "Apple Green", "Grafite"]), {
  standard: ["Black", "Saddle Brown"], special: [], other: ["Apple Green", "Grafite"],
 })
 assert.deepEqual(catalogFinishGroups("dhz-hammerforce-pro", "structure", ["Graphite Black", "Light Grey"]), {
  standard: ["Graphite Black", "Light Grey"], special: [], other: [],
 })
})
