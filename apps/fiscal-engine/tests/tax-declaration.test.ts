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

test("CRT3 explicit declaration generates signed XSD-valid ICMS/PIS/COFINS/IPI and IBS/CBS totals", async () => {
  const result = await dispatch("prepare", preparation());
  const xml = String(result.signedXml);
  for (const tag of ["<CRT>3</CRT>", "<ICMS00>", "<vICMS>18.00</vICMS>", "<vPIS>1.35</vPIS>", "<vCOFINS>6.23</vCOFINS>", "<vIPI>10.00</vIPI>", "<vNF>110.00</vNF>", "<vBCIBSCBS>74.42</vBCIBSCBS>", "<vIBSUF>0.07</vIBSUF>", "<vCBS>0.67</vCBS>", "<indFinal>0</indFinal>", "<indIEDest>1</indIEDest>"]) assert.ok(xml.includes(tag), tag);
  assert.match(xml, /<Signature /);
});

test("freight and unconditional discount retain gross product prices and balance signed XML totals", async () => {
  const input = preparation();
  input.draft.freightMode = "0";
  Object.assign(input.draft.items[0], { freightAmount: "20.00", discountAmount: "5.00" });
  input.draft.payments[0].amount = "126.50";
  const xml = String((await dispatch("prepare", input)).signedXml);
  for (const tag of ["<vProd>100.00</vProd>", "<vFrete>20.00</vFrete>", "<vDesc>5.00</vDesc>", "<vIPI>11.50</vIPI>", "<vICMS>20.70</vICMS>", "<vPIS>1.56</vPIS>", "<vCOFINS>7.17</vCOFINS>", "<vNF>126.50</vNF>", "<modFrete>0</modFrete>"]) assert.ok(xml.includes(tag), tag);
  assert.equal(mapDraft(input).items[0].unitPrice, 100);
});

function interstatePreparation(): any {
  const input = preparation();
  Object.assign(input.draft.recipient, { state: "MG", municipalityCode: "3106200", postalCode: "30110000" });
  input.draft.items[0].cfop = "6102";
  input.draft.taxDeclaration.icmsRate = "12.0000";
  return input;
}

test("interstate CRT3 taxpayer operation has declared ICMS and no consumer DIFAL", async () => {
  const xml = String((await dispatch("prepare", interstatePreparation())).signedXml);
  assert.match(xml, /<idDest>2<\/idDest>/);
  assert.match(xml, /<CFOP>6102<\/CFOP>/);
  assert.match(xml, /<vICMS>12.00<\/vICMS>/);
  assert.doesNotMatch(xml, /<ICMSUFDest>/);
});

test("interstate non-taxpayer requires explicit destination rates and emits item and total DIFAL/FCP", async () => {
  const input = interstatePreparation();
  Object.assign(input.draft.taxDeclaration, { recipientTaxpayer: false, recipientStateRegistration: null, finalConsumer: true, ipiInIcmsBase: true, destinationIcmsRate: "20.0000", destinationFcpRate: "2.0000" });
  input.draft.items[0].cfop = "6108";
  const xml = String((await dispatch("prepare", input)).signedXml);
  for (const tag of ["<ICMSUFDest>", "<vBCUFDest>110.00</vBCUFDest>", "<pICMSUFDest>20.0000</pICMSUFDest>", "<pICMSInter>12.00</pICMSInter>", "<vICMSUFDest>8.80</vICMSUFDest>", "<vFCPUFDest>2.20</vFCPUFDest>", "<vBCIBSCBS>67.77</vBCIBSCBS>"]) assert.ok(xml.includes(tag), tag);
  for (const change of [
    (value: any) => { delete value.draft.taxDeclaration.destinationIcmsRate; },
    (value: any) => { delete value.draft.taxDeclaration.destinationFcpRate; },
    (value: any) => { value.draft.taxDeclaration.destinationIcmsRate = "7.0000"; },
    (value: any) => { value.draft.taxDeclaration.icmsRate = "18.0000"; },
  ]) {
    const invalid = structuredClone(input); change(invalid);
    assert.throws(() => mapDraft(invalid));
  }
});

test("freight and discount reject inconsistent transport, excessive discounts, precision and payment mismatches", () => {
  for (const change of [
    (input: any) => { input.draft.items[0].freightAmount = "1.00"; },
    (input: any) => { input.draft.freightMode = "8"; },
    (input: any) => { input.draft.items[0].discountAmount = "100.01"; },
    (input: any) => { input.draft.items[0].discountAmount = "-1.00"; },
    (input: any) => { input.draft.items[0].discountAmount = "1.001"; },
    (input: any) => { input.draft.items[0].discountAmount = "5.00"; },
  ]) {
    const input = preparation(); change(input);
    assert.throws(() => mapDraft(input));
  }
});

test("CRT3 missing, malformed, unknown or unsupported tax declarations fail closed", () => {
  for (const change of [
    (input: any) => { delete input.draft.taxDeclaration; },
    (input: any) => { delete input.draft.taxRuleReference; },
    (input: any) => { delete input.draft.taxDeclaration.icmsRate; },
    (input: any) => { delete input.draft.taxDeclaration.pisRate; },
    (input: any) => { input.draft.taxDeclaration.pisRate = "1.65001"; },
    (input: any) => { input.draft.taxDeclaration.icmsRate = "100.0000"; },
    (input: any) => { input.draft.taxDeclaration.icmsRate = 18; },
    (input: any) => { input.draft.taxDeclaration.guessed = true; },
    (input: any) => { input.draft.taxDeclaration.ibsCbs.cst = "200"; },
    (input: any) => { delete input.draft.taxDeclaration.ibsCbs; },
    (input: any) => { delete input.draft.taxDeclaration.finalConsumer; },
    (input: any) => { input.draft.taxDeclaration.recipientTaxpayer = false; },
    (input: any) => { input.draft.recipient.state = "RJ"; input.draft.items[0].cfop = "6102"; },
    (input: any) => { input.draft.items.push({ ...input.draft.items[0], icmsCst: "40" }); },
  ]) {
    const input = preparation(); change(input);
    assert.throws(() => mapDraft(input));
  }
});

test("CRT3 rates require explicit zero and payment includes item-rounded IPI", async () => {
  const input = preparation();
  Object.assign(input.draft.taxDeclaration, { icmsRate: "0.0000", pisRate: "0.0000", cofinsRate: "0.0000", ipiRate: "0.0000" });
  input.draft.payments[0].amount = "100.00";
  assert.match(String((await dispatch("prepare", input)).signedXml), /<pICMS>0.0000<\/pICMS>/);
  const wrongPayment = preparation(); wrongPayment.draft.payments[0].amount = "100.00";
  assert.throws(() => mapDraft(wrongPayment), /pagamento|total/i);
  const rounding = preparation();
  Object.assign(rounding.draft.items[0], { unitPrice: "0.0500000000", grossTotal: "0.05" });
  rounding.draft.productsTotal = "0.05"; rounding.draft.payments[0].amount = "0.06";
  const xml = String((await dispatch("prepare", rounding)).signedXml);
  assert.match(xml, /<vIPI>0.01<\/vIPI>/); assert.match(xml, /<vNF>0.06<\/vNF>/);
});

test("CRT3 untaxed ICMS classes preserve explicit taxpayer and contribution declarations", async () => {
  for (const cst of ["40", "41", "50"]) {
    const input = preparation(); input.draft.items[0].icmsCst = cst;
    input.draft.taxDeclaration.icmsRate = null;
    const xml = String((await dispatch("prepare", input)).signedXml);
    assert.match(xml, new RegExp(`<ICMS40><orig>0</orig><CST>${cst}</CST></ICMS40>`));
  }
});

test("CRT3 consumer and tax base decisions are explicit, and precision loss is blocked", async () => {
  const input = preparation();
  Object.assign(input.draft.taxDeclaration, { recipientTaxpayer: false, recipientStateRegistration: null, finalConsumer: true, ipiInIcmsBase: true });
  const xml = String((await dispatch("prepare", input)).signedXml);
  assert.match(xml, /<indFinal>1<\/indFinal>/);
  assert.match(xml, /<indIEDest>9<\/indIEDest>/);
  assert.match(xml, /<vBC>110.00<\/vBC><pICMS>18.0000<\/pICMS><vICMS>19.80<\/vICMS>/);
  const imprecise = preparation();
  Object.assign(imprecise.draft.items[0], { unitPrice: "99999999999.9999999999", grossTotal: "100000000000.00" });
  imprecise.draft.productsTotal = "100000000000.00";
  assert.throws(() => mapDraft(imprecise), /precis|total/i);
  const impossibleBase = preparation();
  Object.assign(impossibleBase.draft.taxDeclaration, { pisRate: "99.9999", cofinsRate: "99.9999" });
  assert.throws(() => mapDraft(impossibleBase), /negativa|base/i);
});
