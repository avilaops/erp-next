import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatch, mapDraft } from "../src/engine.ts";
import { testPfx } from "./fiscal-helpers.ts";
function preparation(): any {
  return {
    environment: "homologation", number: 123, issuedAt: "2026-10-17T13:00:00Z", randomCode: "48291736",
    certificate: { pkcs12Base64: Buffer.from(testPfx({ name: "EMITENTE TESTE:12345678000195" })).toString("base64"), password: "senha-de-teste" },
    issuer: { taxId: "12345678000195", company: { legalName: "EMITENTE TESTE", taxId: "12345678000195", state: "SP", postalCode: "15035000", street: "Rua de Teste", number: "1", district: "Centro" }, profile: { state: "SP", municipalityCode: "3549805", stateRegistration: "110042490114", crt: 3, series: 1 } },
    draft: {
      environment: "homologation", model: 55, operationNature: "Venda de mercadoria", taxRuleReference: "Responsável fiscal: instrução de teste",
      recipient: { taxId: "11222333000181", legalName: "CLIENTE TESTE", state: "SP", municipalityCode: "3549805", postalCode: "15035000", street: "Rua Teste", number: "2", district: "Centro" },
      items: [{ code: "TEST-1", description: "Produto de teste", unit: "UN", ncm: "95069100", cfop: "5102", quantity: "1.0000", unitPrice: "100.0000000000", grossTotal: "100.00", origin: 0, icmsCst: "00", csosn: null, pisCst: "01", cofinsCst: "01" }],
      productsTotal: "100.00", payments: [{ code: "17", amount: "110.00" }],
      taxDeclaration: {
        recipientTaxpayer: true, recipientStateRegistration: "110042490114", finalConsumer: false,
        icmsRate: "18.0000", pisRate: "1.6500", cofinsRate: "7.6000", ipiCst: "50", ipiFrameCode: "999", ipiRate: "10.0000", ipiInIcmsBase: false, icmsOutOfContributions: true,
        ibsCbs: { cst: "000", classCode: "000001", ibsStateRate: "0.1000", ibsCityRate: "0.0000", cbsRate: "0.9000" },
      },
    },
  };
}

const origin = "35261012345678000195550010000001231482917364";
function financial(purpose: 5 | 6, subtype: string): any {
  const input = preparation(), draft = input.draft;
  input.number = 124;
  draft.purpose = purpose; draft[purpose === 5 ? "creditType" : "debitType"] = subtype;
  draft.items[0].cfop = purpose === 5 ? "1102" : "5102";
  draft.payments = [{ code: "90", amount: "0.00" }]; draft.presenceIndicator = 0;
  if (purpose === 5 && ["01", "03", "04"].includes(subtype)) draft.referencedAccessKeys = [origin];
  if (purpose === 5 && subtype === "06" || purpose === 6 && ["03", "04"].includes(subtype)) draft.items[0].referencedDfe = { accessKey: origin, ...(subtype === "03" && purpose === 6 ? {} : { itemNumber: 1 }) };
  if (purpose === 6 || subtype === "01") {
    Object.assign(draft.items[0], { icmsCst: "41", pisCst: "07", cofinsCst: "07" });
    Object.assign(draft.taxDeclaration, { icmsRate: "0.0000", pisRate: "0.0000", cofinsRate: "0.0000", ipiCst: null, ipiFrameCode: null, ipiRate: "0.0000", finalConsumer: false, recipientTaxpayer: false, recipientStateRegistration: null });
  }
  return input;
}
test("credit 01 signs incoming NF-e with explicit subtype, header origin and IBS/CBS only", async () => {
  const xml = String((await dispatch("prepare", financial(5, "01"))).signedXml);
  for (const expected of ["<tpNF>0</tpNF>", "<finNFe>5</finNFe><tpNFCredito>01</tpNFCredito>", "<CFOP>1102</CFOP>", `<NFref><refNFe>${origin}</refNFe></NFref>`, "<IBSCBS>", "<vBCIBSCBS>100.00</vBCIBSCBS>"]) assert.ok(xml.includes(expected), expected);
  assert.doesNotMatch(xml, /<ICMS>|<PIS>|<COFINS>|<IPI>|<tpNFDebito>/);
});
test("credit 03 and 04 retain declared legacy taxes and exactly one original header", async () => {
  for (const subtype of ["03", "04"]) {
    const xml = String((await dispatch("prepare", financial(5, subtype))).signedXml);
    assert.ok(xml.includes(`<tpNFCredito>${subtype}</tpNFCredito>`)); assert.match(xml, /<tpNF>0<\/tpNF>/); assert.match(xml, /<ICMS00>/); assert.match(xml, /<IPI>/); assert.doesNotMatch(xml, /<DFeReferenciado>/);
  }
});
test("credit 06 partial refusal signs per-item original references instead of header references", async () => {
  const xml = String((await dispatch("prepare", financial(5, "06"))).signedXml);
  assert.ok(xml.includes(`<DFeReferenciado><chaveAcesso>${origin}</chaveAcesso><nItem>1</nItem></DFeReferenciado>`));
  assert.match(xml, /<finNFe>5<\/finNFe><tpNFCredito>06<\/tpNFCredito>/); assert.doesNotMatch(xml, /<NFref>/);
});
test("debit 03 and 04 sign outgoing IBS/CBS notes with their distinct item-reference rules", async () => {
  for (const subtype of ["03", "04"]) {
    const xml = String((await dispatch("prepare", financial(6, subtype))).signedXml);
    assert.ok(xml.includes(`<finNFe>6</finNFe><tpNFDebito>${subtype}</tpNFDebito>`)); assert.match(xml, /<tpNF>1<\/tpNF>/);
    assert.ok(xml.includes(`<DFeReferenciado><chaveAcesso>${origin}</chaveAcesso>${subtype === "04" ? "<nItem>1</nItem>" : ""}</DFeReferenciado>`));
    assert.doesNotMatch(xml, /<ICMS>|<PIS>|<COFINS>|<IPI>/);
  }
});
test("advance-payment debit keeps explicitly declared 2026 PIS/COFINS and excludes ICMS/IPI", async () => {
  const input = financial(6, "06");
  Object.assign(input.draft.items[0], { pisCst: "01", cofinsCst: "01" });
  Object.assign(input.draft.taxDeclaration, { pisRate: "1.6500", cofinsRate: "7.6000" });
  const xml = String((await dispatch("prepare", input)).signedXml);
  assert.match(xml, /<tpNFDebito>06<\/tpNFDebito>/); assert.match(xml, /<vPIS>1.65<\/vPIS>/); assert.match(xml, /<vCOFINS>7.60<\/vCOFINS>/); assert.doesNotMatch(xml, /<ICMS>|<IPI>/);
  Object.assign(input.draft.taxDeclaration, { ipiCst: "50", ipiFrameCode: "999", ipiRate: "10.0000" }); assert.throws(() => mapDraft(input), /PL_010g/);
});
test("financial notes reject invalid subtype, origin, direction, legacy taxes and unsupported mandatory groups", () => {
  for (const [purpose, subtype] of [[5,"02"],[5,"05"],[6,"01"],[6,"02"],[6,"05"],[6,"07"],[6,"08"]] as const) assert.throws(() => mapDraft(financial(purpose, subtype)), /grupo|suportado/i);
  const changes = [
    (v: any) => { delete v.draft.creditType; },
    (v: any) => { v.draft.debitType = "04"; },
    (v: any) => { v.draft.items[0].cfop = "5102"; },
    (v: any) => { v.draft.returnDirection = "incoming"; },
    (v: any) => { delete v.draft.referencedAccessKeys; },
    (v: any) => { v.draft.items[0].referencedDfe = { accessKey: origin, itemNumber: 1 }; },
    (v: any) => { v.draft.items[0].icmsCst = "00"; v.draft.taxDeclaration.icmsRate = "18.0000"; },
    (v: any) => { v.draft.items[0].pisCst = "01"; v.draft.taxDeclaration.pisRate = "1.6500"; },
    (v: any) => { v.issuer.profile.crt = 1; delete v.draft.taxDeclaration; },
  ];
  for (const change of changes) { const input = financial(5, "01"); change(input); assert.throws(() => mapDraft(input), String(change)); }
  const third = financial(6,"03"); third.draft.items[0].referencedDfe.itemNumber = 1; assert.throws(() => mapDraft(third), /item/i);
  const fourth = financial(6,"04"); delete fourth.draft.items[0].referencedDfe.itemNumber; assert.throws(() => mapDraft(fourth), /item/i);
  const ordinary = preparation(); ordinary.draft.creditType = "01"; assert.throws(() => mapDraft(ordinary), /crédito/i);
});
