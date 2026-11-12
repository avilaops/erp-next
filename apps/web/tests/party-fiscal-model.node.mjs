import assert from "node:assert/strict"
import { test } from "node:test"
import { blankDraft, blankTaxDeclaration, applyRecipientFiscal } from "../src/features/fiscal/nfe-draft-model.ts"

test("client fiscal selection preserves tax rates and copies the explicit indicator without assuming final consumer", () => {
  const draft = { ...blankDraft(), taxDeclaration: { ...blankTaxDeclaration(), icmsRate: "18", finalConsumer: null } }
  const result = applyRecipientFiscal(draft, { taxpayerIndicator: "2", stateRegistration: null }, 3)
  assert.equal(result.taxDeclaration.recipientTaxpayerIndicator, "2")
  assert.equal(result.taxDeclaration.recipientTaxpayer, true)
  assert.equal(result.taxDeclaration.recipientStateRegistration, null)
  assert.equal(result.taxDeclaration.icmsRate, "18")
  assert.equal(result.taxDeclaration.finalConsumer, null)
  assert.equal(draft.taxDeclaration.recipientTaxpayer, null)
})

test("a new client with unknown status clears the previous client's fiscal identity", () => {
  const draft = applyRecipientFiscal(blankDraft(), { taxpayerIndicator: "1", stateRegistration: "110042490114" }, 3)
  const result = applyRecipientFiscal(draft, null, 3)
  assert.equal(result.taxDeclaration.recipientTaxpayer, null)
  assert.equal(result.taxDeclaration.recipientTaxpayerIndicator, undefined)
  assert.equal(result.taxDeclaration.recipientStateRegistration, null)
})

test("recipient selection does not add a CRT3 declaration to Simples, and NFC-e retains its non-taxpayer scope", () => {
  assert.equal(applyRecipientFiscal(blankDraft(), { taxpayerIndicator: "1", stateRegistration: "110042490114" }, 1).taxDeclaration, undefined)
  const draft = { ...blankDraft(), model: 65, taxDeclaration: blankTaxDeclaration() }
  const result = applyRecipientFiscal(draft, { taxpayerIndicator: "2", stateRegistration: null }, 3)
  assert.equal(result.taxDeclaration.recipientTaxpayerIndicator, "9")
  assert.equal(result.taxDeclaration.recipientTaxpayer, false)
  assert.equal(result.taxDeclaration.recipientStateRegistration, null)
})
