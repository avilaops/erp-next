import assert from "node:assert/strict";
import { test } from "node:test";
import { applyTaxProfile, blankDraft, blankItem, blankTaxDeclaration, invoiceTotal, submission } from "../src/features/fiscal/nfe-draft-model.ts";

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

test("applying a reusable profile preserves item origin, CFOP, recipient decisions and unknown rates", () => {
 const draft=blankDraft(); draft.items[0].origin=2; draft.items[0].cfop="5102";
 const profile={name:"Importados",operationNature:"Venda",pisRate:"1.6500",cofinsRate:"7.6000",ibsCbsCst:"000",classCode:"000001",active:true};
 const applied=applyTaxProfile(draft,profile,4);
 assert.equal(applied.items[0].origin,2); assert.equal(applied.items[0].cfop,"5102");
 assert.equal(applied.taxDeclaration.pisRate,"1.6500"); assert.equal(applied.taxDeclaration.cofinsRate,"7.6000");
 assert.equal(applied.taxDeclaration.ibsCbs.classCode,"000001"); assert.equal(applied.taxDeclaration.ibsCbs.cst,"000");
 assert.equal(applied.taxDeclaration.icmsRate,null); assert.equal(applied.taxDeclaration.finalConsumer,null);
 assert.equal(applied.taxDeclaration.ibsCbs.cbsRate,""); assert.equal(draft.taxDeclaration,undefined);
 assert.throws(()=>submission(applied),/Informe|Declare/);
 applied.taxDeclaration.icmsRate="18.0000";
 assert.equal(applyTaxProfile(applied,profile,5).taxDeclaration.icmsRate,"18.0000");
});
