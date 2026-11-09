import assert from "node:assert/strict"
import { test } from "node:test"
import { validMunicipalityCode, lookupMunicipalityCode, applyMunicipalityCode } from "../src/lib/municipality-code.ts"

const recipient = { taxId: "11222333000181", postalCode: "01001000", state: "SP", cityName: "São Paulo", municipalityCode: "", street: "Praça da Sé", number: "1" }
const reply = () => ({ tenantId: "tenant", kind: "cep", value: "01001000", status: "found", expiresAt: new Date(Date.now() + 60000).toISOString(), data: { fields: { state: "SP", city: "São Paulo", municipalityCode: "3550308" } } })
const fetcher = (value, session = "tenant") => async url => new Response(JSON.stringify(url.endsWith("/me") ? { tenant: { id: session } } : value))

test("municipality code requires seven digits and the declared UF prefix", () => {
 assert.equal(validMunicipalityCode("3550308", "SP"), true)
 for (const code of ["355030", "35503080", "3304557", "abcdefg"]) assert.equal(validMunicipalityCode(code, "SP"), false)
})
test("legacy address resolves IBGE only from matching CEP, city and UF and current session", async () => {
 assert.equal(await lookupMunicipalityCode(recipient, "tenant", new AbortController().signal, fetcher(reply())), "3550308")
 for (const fields of [{ state: "RJ" }, { city: "Santos" }, { municipalityCode: "3304557" }]) {
  const value = reply(); Object.assign(value.data.fields, fields)
  assert.equal(await lookupMunicipalityCode(recipient, "tenant", new AbortController().signal, fetcher(value)), null)
 }
 for (const patch of [{ tenantId: "other" }, { value: "99999999" }, { value: "abc01001000" }, { expiresAt: "invalid" }, { expiresAt: "2020-01-01" }, { status: "not_found" }]) {
  assert.equal(await lookupMunicipalityCode(recipient, "tenant", new AbortController().signal, fetcher({ ...reply(), ...patch })), null)
 }
 assert.equal(await lookupMunicipalityCode(recipient, "tenant", new AbortController().signal, fetcher(reply(), "other")), null)
 assert.equal(await lookupMunicipalityCode({ ...recipient, cityName: "" }, "tenant", new AbortController().signal, async () => { throw new Error("empty city must not query") }), null)
})
test("late lookup preserves manual code and address edits and patches only IBGE", () => {
 const current = { ...recipient, legalName: "Manual", phone: "11999999999" }
 assert.deepEqual(applyMunicipalityCode(current, recipient, "3550308"), { ...current, municipalityCode: "3550308" })
 for (const patch of [{ municipalityCode: "3548500" }, { postalCode: "11010000" }, { cityName: "Santos" }, { state: "RJ" }, { taxId: "52998224725" }, { street: "Rua editada" }]) {
  const changed = { ...current, ...patch }
  assert.equal(applyMunicipalityCode(changed, recipient, "3550308"), changed)
 }
})
