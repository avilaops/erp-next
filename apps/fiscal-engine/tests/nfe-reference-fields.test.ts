import assert from "node:assert/strict";
import { test } from "node:test";
import { mapDraft, dispatch } from "../src/engine.ts";
import { testPfx } from "./fiscal-helpers.ts";

function input() {
 return {
  environment: "homologation", number: 123, issuedAt: "2026-11-08T09:00:00Z", randomCode: "48291736",
  certificate: { pkcs12Base64: Buffer.from(testPfx({ name: "EMITENTE TESTE:12345678000195" })).toString("base64"), password: "senha-de-teste" },
  issuer: { taxId: "12345678000195", company: { legalName: "EMITENTE TESTE", taxId: "12345678000195", state: "SP", postalCode: "15035000", street: "Rua Teste", number: "1", district: "Centro" }, profile: { state: "SP", municipalityCode: "3549805", stateRegistration: "110042490114", crt: 1, series: 1 } },
  draft: {
   model: 55, environment: "homologation", operationNature: "Venda", taxRuleReference: "Instrução de teste", issuedAt: "2026-11-08T06:00:00-03:00", departureAt: "2026-11-08T07:00:00-03:00", presenceIndicator: 2, printType: 2, finalConsumer: true,
   recipient: { taxId: "11222333000181", legalName: "CLIENTE TESTE", state: "SP", municipalityCode: "3549805", postalCode: "15035000", street: "Rua Teste", number: "2", district: "Centro", complement: "Sala 5", phone: "17999990000", email: "cliente@example.test" },
   items: [{ code: "P1", description: "Produto de teste", unit: "UN", ncm: "95069100", cfop: "5102", quantity: "1.0000", unitPrice: "100.0000000000", grossTotal: "100.00", origin: 0, csosn: "102", pisCst: "07", cofinsCst: "07" }], productsTotal: "100.00", payments: [{ code: "17", amount: "100.00" }]
  }
 };
}
test("reference fields survive mapping and signed XML preparation", async () => {
 const source = input(), mapped = mapDraft(source);
 assert.equal(mapped.presenceIndicator, 2);
 assert.equal(mapped.printType, 2);
 assert.equal(mapped.departureAt, "2026-11-08T07:00:00-03:00");
 assert.equal(mapped.recipient.email, "cliente@example.test");
 assert.equal(mapped.recipient.complement, "Sala 5");
 const prepared = await dispatch("prepare", source);
 const xml = String(prepared.signedXml);
 for (const [name, value] of [["indPres", "2"], ["tpImp", "2"], ["dhSaiEnt", "2026-11-08T07:00:00-03:00"], ["xCpl", "Sala 5"], ["fone", "17999990000"], ["email", "cliente@example.test"]]) assert.ok(xml.includes(`<${name}>${value}</${name}>`), name);
});
test("invalid presence, contradictory issue dates and departure before issue are refused", () => {
 const source = input();
 for (const presenceIndicator of [-1, 6, 8, 10, 1.5]) assert.throws(() => mapDraft({ ...source, draft: { ...source.draft, presenceIndicator } }), /presença/i);
 assert.throws(() => mapDraft({ ...source, issuedAt: "2026-11-09T09:00:00Z" }), /data.*emissão|emissão.*data/i);
 assert.throws(() => mapDraft({ ...source, draft: { ...source.draft, departureAt: "2026-11-07T07:00:00-03:00" } }), /saída/i);
});
test("legacy drafts retain presence 9 and normal print layout", () => {
 const source = input();
 const { issuedAt, departureAt, presenceIndicator, printType, ...draft } = source.draft;
 void issuedAt; void departureAt; void presenceIndicator; void printType;
 const mapped = mapDraft({ ...source, draft });
 assert.equal(mapped.presenceIndicator, 9);
 assert.equal(mapped.printType, 1);
});

test("complementary and adjustment NF-e preserve purpose and references in signed XML", async () => {
 for (const purpose of [2, 3]) {
  const source = input();
  const prepared = await dispatch("prepare", { ...source, draft: { ...source.draft, purpose, referencedAccessKeys: ["35261012345678000195550010000001231482917364"], payments: [{ code: "90", amount: "0.00" }] } });
  const xml = String(prepared.signedXml);
  assert.ok(xml.includes(`<finNFe>${purpose}</finNFe>`));
  assert.ok(xml.includes("<NFref><refNFe>35261012345678000195550010000001231482917364</refNFe></NFref>"));
 }
});

test("transport, retentions, XML access, installments and intermediary reach the XML", async () => {
 const source = input();
 const prepared = await dispatch("prepare", { ...source, draft: { ...source.draft, freightMode: "0",
  transport: { carrierTaxId: "11222333000181", carrierName: "TRANSPORTADORA TESTE", state: "SP", stateRegistration: "110042490114", address: "Rua A 10", city: "São Paulo", plate: "ABC1D23", vehicleState: "SP", rntc: "12345678", volumes: 2, volumeKind: "Caixa", volumeNumber: "1 a 2", brand: "Ludus", grossWeight: "120.000", netWeight: "110.000" },
  retentions: { pis: "1.00", cofins: "2.00", csll: "3.00", incomeTaxBase: "100.00", incomeTax: "1.50" },
  authorizedXml: [{ taxId: "11222333000181", name: "Contabilidade" }],
  intermediary: { taxId: "11222333000181", registration: "LOJA123" },
  installments: [{ number: "001", dueDate: "2026-12-08", amount: "100.00" }],
  taxAuthorityInformation: "Informacao declarada ao fisco",
  additionalInformation: "Pedido teste"
 } });
 const xml = String(prepared.signedXml);
 for (const value of ["<transporta>", "<veicTransp><placa>ABC1D23</placa>", "<qVol>2</qVol>", "<pesoB>120.000</pesoB>", "<marca>Ludus</marca>", "<vRetPIS>1.00</vRetPIS>", "<autXML><CNPJ>11222333000181</CNPJ></autXML>", "<indIntermed>1</indIntermed>", "<infIntermed><CNPJ>11222333000181</CNPJ>", "<infAdFisco>Informacao declarada ao fisco</infAdFisco>", "<dup><nDup>001</nDup><dVenc>2026-12-08</dVenc><vDup>100.00</vDup></dup>"]) assert.ok(xml.includes(value), value);
});
test("insurance and other charges affect exact totals and product XML", async () => {
 const source = input();
 const prepared = await dispatch("prepare", { ...source, draft: { ...source.draft,
  items: [{ ...source.draft.items[0], insuranceAmount: "5.00", otherAmount: "2.00" }],
  payments: [{ code: "17", amount: "107.00" }]
 } });
 const xml = String(prepared.signedXml);
 assert.ok(xml.includes("<vNF>107.00</vNF>"));
 assert.equal((xml.match(/<vSeg>5.00<\/vSeg>/g) || []).length, 2);
 assert.equal((xml.match(/<vOutro>2.00<\/vOutro>/g) || []).length, 2);
});

test("retentions precede IBS/CBS totals for normal-regime invoices", async () => {
 const source = input();
 const prepared = await dispatch("prepare", { ...source, issuer: { ...source.issuer, profile: { ...source.issuer.profile, crt: 3 } }, draft: { ...source.draft,
  items: [{ ...source.draft.items[0], csosn: null, icmsCst: "00" }],
  retentions: { pis: "1.00" },
  taxDeclaration: { recipientTaxpayer: false, recipientStateRegistration: null, finalConsumer: true, icmsRate: "0.0000", pisRate: "0.0000", cofinsRate: "0.0000", ipiCst: null, ipiFrameCode: null, ipiRate: null, ipiInIcmsBase: false, icmsOutOfContributions: false, ibsCbs: { cst: "000", classCode: "000001", ibsStateRate: "0.0000", ibsCityRate: "0.0000", cbsRate: "0.0000" } }
 } });
 const xml = String(prepared.signedXml);
 assert.ok(xml.indexOf("<retTrib>") < xml.indexOf("<IBSCBSTot>"));
});
