import assert from "node:assert/strict";
import { test } from "node:test";
import { applyTaxProfile, blankDraft, blankItem, blankTaxDeclaration, invoiceTotal, submission } from "../src/features/fiscal/nfe-draft-model.ts";
import { ludusProfiles, normalizedProfile } from "../src/features/fiscal/settings/tax-profile-model.ts";

test("Ludus presets are defaults-only profiles without incomplete commercial-line rules", () => {
  for (const preset of ludusProfiles()) {
    const payload = JSON.parse(JSON.stringify(normalizedProfile(preset)));
    assert.equal(payload.productLine, undefined);
    assert.equal(payload.lineRules, undefined);
    assert.ok(payload.defaults);
  }
});

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

test("freight and discount retain original gross prices and round IPI per commercial item", () => {
  const draft = blankDraft();
  draft.freightMode = "0";
  draft.items = [{ ...blankItem(), unitPrice: "100", origin: 0, icmsCst: "00", freightAmount: "20,00", discountAmount: "5" }];
  draft.taxDeclaration = { ...blankTaxDeclaration(), recipientTaxpayer: false, finalConsumer: true, ipiInIcmsBase: true, icmsOutOfContributions: false, ipiRate: "10", destinationIcmsRate: "20", destinationFcpRate: "0", ibsCbs: { cst: "000", classCode: "000001", ibsStateRate: "0,1", ibsCityRate: "0", cbsRate: "0,9" } };
  assert.equal(invoiceTotal(draft), "126.50");
  const saved = submission(draft);
  assert.equal(saved.productsTotal, "100.00");
  assert.equal(saved.items[0].unitPrice, "100.0000000000");
  assert.equal(saved.items[0].freightAmount, "20.00");
  assert.equal(saved.items[0].discountAmount, "5.00");
  assert.equal(saved.taxDeclaration.destinationIcmsRate, "20.0000");
  assert.equal(saved.taxDeclaration.destinationFcpRate, "0.0000");
  draft.freightMode = "9";
  assert.throws(() => submission(draft), /Frete/);
  draft.freightMode = "0";
  draft.items[0].discountAmount = "100,01";
  assert.throws(() => submission(draft), /desconto/);
});

test("documented Ludus defaults fill missing tax fields without inferring product or recipient data", () => {
  const [imported, national] = ludusProfiles();
  const draft = blankDraft();
  const applied = applyTaxProfile(draft, imported, 2);
  assert.equal(applied.operationNature, "Venda de Mercadoria Importada");
  assert.equal(applied.items[0].icmsCst, "00");
  assert.equal(applied.items[0].pisCst, "01");
  assert.equal(applied.items[0].cofinsCst, "01");
  assert.equal(applied.items[0].origin, -1);
  assert.equal(applied.items[0].cfop, "");
  assert.equal(applied.taxDeclaration.ipiCst, "50");
  assert.equal(applied.taxDeclaration.ipiFrameCode, "999");
  assert.equal(applied.taxDeclaration.ipiRate, null);
  assert.equal(applied.taxDeclaration.icmsRate, null);
  assert.equal(applied.taxDeclaration.recipientTaxpayer, null);
  assert.equal(applied.taxDeclaration.finalConsumer, true);
  assert.deepEqual(applied.taxDeclaration.ibsCbs, { cst: "000", classCode: "000001", ibsStateRate: "0.1000", ibsCityRate: "0.0000", cbsRate: "0.9000" });
  assert.equal(applyTaxProfile(draft, national, 2).taxDeclaration.ipiCst, "53");
});

test("additional profile defaults preserve existing classifications, explicit false and zero rates", () => {
  const draft = blankDraft();
  draft.items[0] = { ...blankItem(), icmsCst: "40", pisCst: "07", cofinsCst: "07", origin: 2, cfop: "6102" };
  draft.taxDeclaration = { ...blankTaxDeclaration(), finalConsumer: false, ipiInIcmsBase: false, ipiCst: "53", ipiFrameCode: "001", ibsCbs: { cst: "000", classCode: "000001", ibsStateRate: "0.0000", ibsCityRate: "0.0000", cbsRate: "0.0000" } };
  const applied = applyTaxProfile(draft, ludusProfiles()[0], 3);
  assert.equal(applied.items[0].icmsCst, "40");
  assert.equal(applied.items[0].pisCst, "07");
  assert.equal(applied.items[0].cfop, "6102");
  assert.equal(applied.taxDeclaration.finalConsumer, false);
  assert.equal(applied.taxDeclaration.ipiInIcmsBase, false);
  assert.equal(applied.taxDeclaration.ipiCst, "53");
  assert.equal(applied.taxDeclaration.ipiFrameCode, "001");
  assert.equal(applied.taxDeclaration.ibsCbs.cbsRate, "0.0000");
  draft.items[0] = { ...blankItem(), csosn: "102" };
  assert.equal(applyTaxProfile(draft, ludusProfiles()[0], 3).items[0].icmsCst, null);
});
