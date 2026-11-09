import assert from "node:assert/strict"
import { test } from "node:test"
import { clearPartyCnpj, emptyCnpjProvenance, fillPartyCnpj } from "../src/features/parties/party-cnpj.ts"

const blank = () => ({ personType: "juridica", legalName: "", tradeName: null, taxId: "04252011000110", email: null, phone: null, isCustomer: true, isSupplier: false, status: "active", addresses: [], contacts: [] })
const fields = { legalName: "Empresa da fonte", tradeName: "Fantasia", email: "contato@example.test", phone: "1133334444", postalCode: "01001000", state: "SP", city: "São Paulo", street: "Rua cadastral", number: "120", district: "Centro", complement: "Sala 2", taxRegime: "simples", taxpayerStatus: "exempt", isSupplier: "true" }

test("CNPJ address retains valid IBGE and ignores an inconsistent UF prefix", () => {
 assert.equal(fillPartyCnpj(blank(), { ...fields, municipalityCode: "3550308" }, emptyCnpjProvenance()).draft.addresses[0].municipalityCode, "3550308")
 assert.equal(fillPartyCnpj(blank(), { ...fields, municipalityCode: "3304557" }, emptyCnpjProvenance()).draft.addresses[0].municipalityCode, undefined)
})

test("available company contacts and address fill an empty party without fiscal or relationship inference", () => {
  const original = blank()
  const { draft, provenance, count } = fillPartyCnpj(original, fields, emptyCnpjProvenance())
  assert.equal(count, 5)
  assert.equal(draft.legalName, fields.legalName)
  assert.equal(draft.email, fields.email)
  assert.equal(draft.phone, fields.phone)
  assert.deepEqual(draft.addresses, [{ label: "Endereço cadastral", postalCode: "01001000", state: "SP", city: "São Paulo", street: "Rua cadastral", number: "120", district: "Centro", complement: "Sala 2", primary: false }])
  assert.equal(draft.isSupplier, false)
  assert.equal(Object.hasOwn(draft, "taxRegime"), false)
  assert.equal(Object.hasOwn(draft, "taxpayerStatus"), false)
  assert.equal(provenance.address, draft.addresses[0])
  assert.deepEqual(original, blank())
})

test("manual names, contacts and existing addresses are preserved even when another source address is available", () => {
  const original = { ...blank(), legalName: "Nome manual", tradeName: "Fantasia manual", email: "manual@example.test", phone: "11999999999", addresses: [{ label: "Entrega", postalCode: "20040002", state: "RJ", city: "Rio de Janeiro", street: "Rua manual", number: "7", district: "Centro", complement: null, primary: true }], contacts: [{ name: "Contato declarado", email: "pessoa@example.test", phone: null, role: null, primary: true }] }
  const { draft, count } = fillPartyCnpj(original, fields, emptyCnpjProvenance())
  assert.equal(count, 0)
  assert.deepEqual(draft, original)
  assert.equal(draft.addresses, original.addresses)
  assert.equal(draft.contacts, original.contacts)
})

test("repeating a lookup never duplicates the address or loses provenance", () => {
  const first = fillPartyCnpj(blank(), fields, emptyCnpjProvenance())
  const second = fillPartyCnpj(first.draft, fields, first.provenance)
  assert.equal(second.count, 0)
  assert.equal(second.draft.addresses.length, 1)
  assert.deepEqual(second.provenance, first.provenance)
  assert.deepEqual(clearPartyCnpj(second.draft, second.provenance), blank())
})

test("a document change clears unchanged generated values while preserving later manual edits", () => {
  const first = fillPartyCnpj(blank(), fields, emptyCnpjProvenance())
  const edited = { ...first.draft, legalName: "Minha edição", phone: "11912345678" }
  const cleared = clearPartyCnpj(edited, first.provenance)
  assert.equal(cleared.legalName, "Minha edição")
  assert.equal(cleared.phone, "11912345678")
  assert.equal(cleared.email, null)
  assert.equal(cleared.tradeName, null)
  assert.deepEqual(cleared.addresses, [])
  assert.equal(first.draft.email, fields.email)
})

test("an explicitly edited generated address remains intact when the document changes", () => {
  const first = fillPartyCnpj(blank(), fields, emptyCnpjProvenance())
  const edited = { ...first.draft, addresses: [{ ...first.draft.addresses[0], street: "Rua corrigida" }] }
  assert.deepEqual(clearPartyCnpj(edited, first.provenance).addresses, edited.addresses)
  first.provenance.address = null
  assert.deepEqual(clearPartyCnpj(first.draft, first.provenance).addresses, first.draft.addresses)
})

test("unknown and blank values are ignored and missing address facts remain empty", () => {
  const source = { email: "", phone: "   ", city: "São Paulo", secret: "ignored" }
  const { draft } = fillPartyCnpj(blank(), source, emptyCnpjProvenance())
  assert.equal(draft.email, null)
  assert.equal(draft.phone, null)
  assert.equal(draft.addresses[0].number, "")
  assert.equal(draft.addresses[0].postalCode, "")
  assert.equal(Object.hasOwn(draft, "secret"), false)
  assert.equal(fillPartyCnpj(blank(), {}, emptyCnpjProvenance()).count, 0)
})

test("a completely blank address placeholder can be filled while declared address choices remain intact", () => {
  const address = { label: "", postalCode: "", state: "", city: "", street: "", number: "", district: "", complement: null, primary: false }
  const filled = fillPartyCnpj({ ...blank(), addresses: [address] }, fields, emptyCnpjProvenance())
  assert.equal(filled.draft.addresses.length, 1)
  assert.equal(filled.draft.addresses[0].street, fields.street)
  const declared = { ...address, label: "Entrega" }
  assert.deepEqual(fillPartyCnpj({ ...blank(), addresses: [declared] }, fields, emptyCnpjProvenance()).draft.addresses, [declared])
})

test("source values exceeding the existing form limits remain blank without silent truncation", () => {
  const { draft } = fillPartyCnpj(blank(), { ...fields, number: "1".repeat(41), street: "A".repeat(201), phone: "1".repeat(41) }, emptyCnpjProvenance())
  assert.equal(draft.addresses[0].number, "")
  assert.equal(draft.addresses[0].street, "")
  assert.equal(draft.phone, null)
})
