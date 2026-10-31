import assert from "node:assert/strict";
import { test } from "node:test";
import { blankDraft, blankItem, blankTaxDeclaration, invoiceTotal, submission } from "../src/features/fiscal/nfe-draft-model.ts";

test("draft tax fields remain optional for historical drafts and decisions start blank", () => {
  const draft = blankDraft();
  draft.items = [{ ...blankItem(), code: "T", unitPrice: "100", origin: 0, csosn: "102" }];
  assert.equal(submission(draft).taxDeclaration, undefined);
  assert.equal(blankTaxDeclaration().finalConsumer, null);
  draft.taxDeclaration = blankTaxDeclaration();
  assert.throws(() => submission(draft), /Declare/);
});

test("declared percentage normalization preserves zero, rejects extra precision and sums item-rounded IPI", () => {
  const draft = blankDraft();
  draft.items = [1, 2].map(() => ({ ...blankItem(), unitPrice: "0,05", origin: 0, icmsCst: "00" }));
  draft.taxDeclaration = { ...blankTaxDeclaration(), recipientTaxpayer: false, finalConsumer: true, ipiInIcmsBase: true, icmsOutOfContributions: false, icmsRate: "0", ipiCst: "50", ipiFrameCode: "999", ipiRate: "10", ibsCbs: { cst: "000", classCode: "000001", ibsStateRate: "0,1", ibsCityRate: "0", cbsRate: "0,9" } };
  assert.equal(invoiceTotal(draft), "0.12");
  assert.equal(submission(draft).taxDeclaration?.icmsRate, "0.0000");
  assert.equal(submission(draft).taxDeclaration?.ibsCbs.ibsStateRate, "0.1000");
  draft.taxDeclaration.icmsRate = "18.00001"; assert.throws(() => submission(draft));
  draft.taxDeclaration.icmsRate = "100"; assert.throws(() => submission(draft));
});
