import assert from "node:assert/strict"
import { test } from "node:test"
import { readPartyDraft, writePartyDraft, recoverPartyDraft } from "../src/features/parties/party-draft.ts"

const input = { personType: "juridica", legalName: "Empresa declarada", tradeName: null, taxId: "04252011000110", email: null, phone: null, isCustomer: true, isSupplier: false, status: "active", addresses: [], contacts: [], fiscal: null }
const envelope = () => ({ version: 1, draft: { ...input, legalName: "Edição local" }, baseline: JSON.stringify(input), etag: '"3"', uncertain: false, conflict: false, command: null, provenance: { fields: {}, address: null } })
function storage() {
  const data = new Map()
  globalThis.sessionStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }
  return data
}

test("party drafts retain fiscal declaration and remain isolated by supplied session and record scope", () => {
  storage()
  const value = envelope()
  value.draft.fiscal = { taxpayerIndicator: "2", stateRegistration: null }
  assert.equal(writePartyDraft("session-a:party-1", value), true)
  assert.deepEqual(readPartyDraft("session-a:party-1"), { value, error: "" })
  assert.equal(readPartyDraft("session-b:party-1").value, null)
  assert.equal(readPartyDraft("session-a:party-2").value, null)
  assert.equal(writePartyDraft("session-a:party-1", null), true)
  assert.equal(readPartyDraft("session-a:party-1").value, null)
})

test("corruption, unsupported versions, invalid fiscal fields and inconsistent pending commands are retained and refused", () => {
  const data = storage()
  const cases = ["{broken", JSON.stringify({ ...envelope(), version: 9 }), JSON.stringify({ ...envelope(), draft: { ...input, fiscal: { taxpayerIndicator: "3", stateRegistration: null } } }), JSON.stringify({ ...envelope(), uncertain: true }), JSON.stringify({ ...envelope(), uncertain: true, command: { key: "11111111-1111-4111-8111-111111111111", body: JSON.stringify(input) } })]
  for (const raw of cases) {
    data.set("draft", raw)
    assert.match(readPartyDraft("draft").error, /rascunho/)
    assert.equal(readPartyDraft("draft").value, null)
    assert.equal(data.get("draft"), raw)
  }
})

test("lost POST confirmation recovers the identical command and never adopts a new revision", () => {
  storage()
  const value = envelope()
  value.uncertain = true
  value.command = { key: "11111111-1111-4111-8111-111111111111", body: JSON.stringify(value.draft) }
  writePartyDraft("new", value)
  const result = recoverPartyDraft(readPartyDraft("new").value, input, "", false)
  assert.equal(result.value.command.key, value.command.key)
  assert.equal(result.value.command.body, value.command.body)
  assert.equal(result.value.uncertain, true)
  assert.equal(result.value.etag, '"3"')
})

test("concurrent server changes freeze restored PUT while a confirmed lost PUT clears it", () => {
  const value = envelope()
  let result = recoverPartyDraft(value, { ...input, phone: "11999999999" }, '"4"', true)
  assert.equal(result.value.conflict, true)
  assert.equal(result.value.draft.legalName, "Edição local")
  assert.equal(result.value.etag, '"3"')
  value.conflict = true
  value.command = { key: "11111111-1111-4111-8111-111111111111", body: JSON.stringify(value.draft) }
  result = recoverPartyDraft(value, value.draft, '"4"', true)
  assert.equal(result.confirmed, true)
  assert.equal(result.value, null)
})

test("quota or unavailable session storage is reported without deleting any existing draft", () => {
  storage()
  sessionStorage.setItem = () => { throw new Error("quota") }
  assert.equal(writePartyDraft("draft", envelope()), false)
  sessionStorage.getItem = () => { throw new Error("blocked") }
  assert.match(readPartyDraft("draft").error, /rascunho/)
})
