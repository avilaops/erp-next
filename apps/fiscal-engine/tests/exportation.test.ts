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

function exportPreparation(kind = "direct"): any {
  const input = preparation(), draft = input.draft;
  draft.exportation = { kind, exitState: "SP", exportLocation: "Porto de Santos", dispatchLocation: "Santos" };
  Object.assign(draft.recipient, { taxId: "", foreignId: "US123456", state: "EX", municipalityCode: "9999999", postalCode: "", cityName: "Miami", countryCode: "2496", countryName: "ESTADOS UNIDOS" });
  Object.assign(draft.items[0], { cfop: "7102", icmsCst: "41", pisCst: "08", cofinsCst: "08", taxableUnit: "KG", taxableQuantity: "2.0000", taxableUnitPrice: "50.0000000000" });
  Object.assign(draft.taxDeclaration, { recipientTaxpayer: false, recipientStateRegistration: null, finalConsumer: false, icmsRate: "0.0000", pisRate: "0.0000", cofinsRate: "0.0000", ipiCst: "54", ipiFrameCode: "999", ipiRate: "0.0000", ibsCbs: { cst: "410", classCode: "410004", ibsStateRate: "0.0000", ibsCityRate: "0.0000", cbsRate: "0.0000" } });
  draft.payments[0].amount = "100.00";
  return input;
}
test("direct export signs XSD-valid foreign address, customs exit, declared taxable unit and immunity", async () => {
  const xml = String((await dispatch("prepare", exportPreparation())).signedXml);
  for (const expected of ["<idDest>3</idDest>", "<idEstrangeiro>US123456</idEstrangeiro>", "<cMun>9999999</cMun>", "<UF>EX</UF>", "<cPais>2496</cPais>", "<xPais>ESTADOS UNIDOS</xPais>", "<CFOP>7102</CFOP>", "<uTrib>KG</uTrib><qTrib>2.0000</qTrib><vUnTrib>50.0000000000</vUnTrib>", "<IBSCBS><CST>410</CST><cClassTrib>410004</cClassTrib></IBSCBS>", "<exporta><UFSaidaPais>SP</UFSaidaPais><xLocExporta>Porto de Santos</xLocExporta><xLocDespacho>Santos</xLocDespacho></exporta>"]) assert.ok(xml.includes(expected), expected);
  assert.doesNotMatch(xml, /<ICMSUFDest>|<gIBSCBS>/);
});
test("indirect export writes origin NF-e reference and quantity, with empty legacy RE allowed", async () => {
  const input = exportPreparation("indirect");
  input.draft.items[0].exportDetails = [{ drawbackNumber: "20260000001", exportRegistration: "", referencedAccessKey: "35261012345678000195550010000001231482917364", exportedQuantity: "1.0000" }];
  const xml = String((await dispatch("prepare", input)).signedXml);
  assert.match(xml, /<detExport><nDraw>20260000001<\/nDraw><exportInd><nRE><\/nRE><chNFe>35261012345678000195550010000001231482917364<\/chNFe><qExport>1.0000<\/qExport><\/exportInd><\/detExport>/);
});
test("domestic sale to trading keeps domestic destination and does not declare customs exit", async () => {
  const input = preparation(); input.draft.exportation = { kind: "trading" }; input.draft.items[0].cfop = "5502";
  const xml = String((await dispatch("prepare", input)).signedXml);
  assert.match(xml, /<idDest>1<\/idDest>/); assert.match(xml, /<CFOP>5502<\/CFOP>/); assert.doesNotMatch(xml, /<exporta>|<idEstrangeiro>/);
});
test("foreign recipient without foreign tax identifier emits explicit empty idEstrangeiro", async () => {
  const input = exportPreparation(); input.draft.recipient.foreignId = "";
  const xml = String((await dispatch("prepare", input)).signedXml); assert.match(xml, /<idEstrangeiro><\/idEstrangeiro>/);
});
test("export mapping rejects incomplete classifications, addresses, conversion and references", () => {
  const changes = [
    (v: any) => { delete v.draft.exportation; },
    (v: any) => { v.draft.model = 65; },
    (v: any) => { v.draft.exportation.kind = "trading"; },
    (v: any) => { v.draft.exportation.exitState = "EX"; },
    (v: any) => { delete v.draft.exportation.exportLocation; },
    (v: any) => { v.draft.recipient.countryCode = "1058"; },
    (v: any) => { v.draft.recipient.municipalityCode = "3549805"; },
    (v: any) => { v.draft.recipient.taxId = "11222333000181"; },
    (v: any) => { v.draft.items[0].cfop = "6102"; },
    (v: any) => { delete v.draft.items[0].taxableUnit; },
    (v: any) => { v.draft.items[0].taxableQuantity = "3.0000"; },
    (v: any) => { v.draft.taxDeclaration.ibsCbs.ibsStateRate = "0.1000"; },
    (v: any) => { v.draft.exportation.kind = "indirect"; },
    (v: any) => { v.draft.items[0].exportDetails = [{ exportRegistration: "123456789012", referencedAccessKey: "35261012345678000195550010000001231482917364", exportedQuantity: "2.0000" }]; },
  ];
  for (const change of changes) { const input = exportPreparation(); change(input); assert.throws(() => mapDraft(input), String(change)); }
});
