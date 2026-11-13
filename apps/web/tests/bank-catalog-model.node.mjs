import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { banks, searchBanks, identifyBank } from "../src/features/records/reference/bank-catalog.ts"

test("busca bancos por nome, acento, alias e código verificado com zeros", () => {
  for (const query of ["Itau", "ITAÚ", "341"]) assert.equal(searchBanks(query)[0].name, "Itaú Unibanco S.A")
  for (const query of ["bb", "001", "1"]) assert.equal(searchBanks(query)[0].name, "Banco do Brasil S.A")
  assert.equal(searchBanks("077")[0].name, "Banco Inter S.A")
  assert.equal(searchBanks("gerencianet")[0].name, "Efí - Gerencianet")
  assert.equal(searchBanks("Caixa Federal")[0].name, "Caixa Econômica Federal")
  assert.equal(searchBanks("Banco inexistente de teste").length, 0)
  assert.equal(searchBanks("   ").length, banks.length)
})

test("reconhece nomes legados sem substituir a string original nem associar códigos a nomes", () => {
  const legacy = "  ITAU  "
  assert.equal(identifyBank(legacy).name, "Itaú Unibanco S.A")
  assert.equal(legacy, "  ITAU  ")
  assert.equal(identifyBank("260"), undefined)
  assert.equal(identifyBank("Banco privado legado"), undefined)
  assert.equal(identifyBank(null), undefined)
  assert.equal(identifyBank("Nu Pagamentos S.A").name, "Nubank")
})

test("catálogo amplo mantém códigos com fonte oficial e identidade única", () => {
  assert.equal(banks.length, 86)
  assert.equal(new Set(banks.map(bank => bank.id)).size, banks.length)
  assert.equal(new Set(banks.map(bank => bank.name)).size, banks.length)
  assert.equal(banks.filter(bank => bank.code).length, 7)
  for (const bank of banks) {
    assert.ok(bank.name.length <= 100)
    if (bank.code) {
      assert.match(bank.code, /^\d{3}$/)
      assert.match(bank.codeSource, /^https:\/\//)
      assert.equal(bank.codeVerifiedAt, "2026-11-12")
    }
  }
})

test("logos locais correspondem ao manifesto fixado e não contêm conteúdo ativo ou remoto", () => {
  const root = new URL("../public/banks/", import.meta.url)
  const manifest = JSON.parse(readFileSync(new URL("source-manifest.json", root), "utf8"))
  assert.equal(manifest.commit, "fe1d43f0cf379135bd01c987bc147a04fdf48c6d")
  for (const bank of banks) {
    const asset = manifest.assets.find(asset => asset.id === bank.id)
    assert.ok(asset)
    if (!bank.logo) { assert.equal(asset.file, null); continue }
    assert.equal(bank.logo, `/banks/${asset.file}`)
    const file = new URL(asset.file, root)
    assert.ok(existsSync(file))
    const bytes = readFileSync(file)
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256)
    const svg = bytes.toString("utf8")
    assert.doesNotMatch(svg, /<(?:\w+:)?(?:script|foreignObject|image|animate|set)\b|\son\w+\s*=|<!ENTITY|<!DOCTYPE/i)
    for (const match of svg.matchAll(/(?:href)="([^"]*)"/gi)) assert.match(match[1], /^#[\p{L}\p{N}_:.-]+$/u)
    for (const match of svg.matchAll(/url\(([^)]*)\)/gi)) assert.match(match[1], /^['"]?#[\p{L}\p{N}_:.-]+['"]?$/u)
  }
})
