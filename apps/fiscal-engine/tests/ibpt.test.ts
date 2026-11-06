import assert from "node:assert/strict";
import { test } from "node:test";
import { mapDraft } from "../src/engine.ts";
import { buildNfeXml, nfeTotals } from "../src/lib/fiscal/nfe.ts";
import { assertFiscalXml } from "../src/lib/fiscal/local-layout.ts";
import { signNfeXml, signingKeyOf } from "../src/lib/fiscal/sign.ts";
import { layoutInvoice } from "./fiscal-layout-fixture.ts";
import { testPfx } from "./fiscal-helpers.ts";

/** Entirely synthetic source: these amounts are not an IBPT table. */
function preparation(): any {
  const invoice = layoutInvoice();
  const choice = { ex: "0", origin: "national", version: "26.2.C" };
  const amounts = { federal: "1.01", state: "2.02", municipal: "0.03", total: "3.06" };
  return {
    tenantId: "11111111-1111-4111-8111-111111111111", environment: "homologation", number: 123,
    issuedAt: "2026-10-17T13:00:00Z", randomCode: "48291736",
    issuer: { taxId: invoice.issuer.cnpj, company: { ...invoice.issuer, taxId: invoice.issuer.cnpj, state: "SP", postalCode: invoice.issuer.cep }, profile: { state: "SP", municipalityCode: invoice.issuer.cityCode, stateRegistration: invoice.issuer.stateRegistration, crt: 1, series: 1 } },
    draft: {
      environment: "homologation", model: 55, operationNature: "Venda de mercadoria", taxRuleReference: "Instrução sintética",
      recipient: { ...invoice.recipient, taxId: invoice.recipient.document, legalName: invoice.recipient.name, state: "SP", municipalityCode: invoice.recipient.cityCode, postalCode: invoice.recipient.cep },
      items: [{ code: "TEST-01", description: "Produto sintético", unit: "UN", ncm: "95069100", cfop: "5102", quantity: "1.0000", unitPrice: "100.0000000000", grossTotal: "100.00", origin: 0, icmsCst: null, csosn: "102", pisCst: "04", cofinsCst: "04" }],
      productsTotal: "100.00", payments: [{ code: "17", amount: "100.00" }],
      ibpt: { uf: "SP", asOf: "2026-10-17", items: [choice] },
    },
    ibptSnapshot: {
      tenantId: "11111111-1111-4111-8111-111111111111", uf: "SP", asOf: "2026-10-17",
      items: [{ itemCode: "TEST-01", code: "95069100", ex: choice.ex, origin: choice.origin, amount: "100.00", metadata: { uf: "SP", classification: "ncm", version: "26.2.C", source: "Fonte & <sintética>", key: "chave sintética", validFrom: "2026-10-01", validTo: "2026-10-31", sha256: "a".repeat(64) }, amounts: { ...amounts } }],
      amounts,
    },
  };
}

test("IBPT snapshot exports exact per-item and aggregate approximate taxes without changing operation totals", async () => {
  const input = preparation(), mapped = mapDraft(input);
  assert.deepEqual(mapped.approximateTaxes?.items, ["3.06"]);
  assert.equal(mapped.approximateTaxes?.total, "3.06");
  const absent = preparation(); delete absent.draft.ibpt; delete absent.ibptSnapshot;
  assert.deepEqual(nfeTotals(mapped), nfeTotals(mapDraft(absent)));
  const xml = buildNfeXml(mapped).xml;
  assert.match(xml, /<imposto><vTotTrib>3.06<\/vTotTrib><ICMS>/);
  assert.match(xml, /<vNF>100.00<\/vNF><vTotTrib>3.06<\/vTotTrib><\/ICMSTot>/);
  assert.match(xml, /<vPag>100.00<\/vPag>/);
  assert.match(xml, /Tributos aproximados.*federais.*1.01.*estaduais.*2.02.*municipais.*0.03/);
  assert.match(xml, /Fonte &amp; &lt;sintética&gt;/);
  assert.match(xml, /26.2.C.*SP.*chave sintética/);
  assert.equal(xml.replace(/<vTotTrib>[^<]*<\/vTotTrib>/g, "").replace(/<infAdic>[\s\S]*?<\/infAdic>/, ""), buildNfeXml(mapDraft(absent)).xml);
  await assertFiscalXml(signNfeXml(xml, signingKeyOf(testPfx(), "senha-de-teste")), "nfe");
});

test("IBPT snapshot binds the commercial item including declared freight and discount", async () => {
  const input = preparation();
  input.draft.freightMode = "0";
  Object.assign(input.draft.items[0], { freightAmount: "10.00", discountAmount: "5.00" });
  input.draft.payments[0].amount = "105.00";
  input.ibptSnapshot.items[0].amount = "105.00";
  const xml = String((await dispatch("prepare", input)).signedXml);
  assert.match(xml, /<vNF>105.00<\/vNF>/);
  assert.match(xml, /<vTotTrib>3.06<\/vTotTrib>/);
  input.ibptSnapshot.items[0].amount = "100.00";
  assert.throws(() => mapDraft(input), /Base.*IBPT/);
});

test("IBPT absent/null selection retains byte-identical XML and does not infer origins", () => {
  const a = preparation(); delete a.draft.ibpt; delete a.ibptSnapshot;
  const b = structuredClone(a); b.draft.ibpt = null; b.ibptSnapshot = null;
  assert.equal(buildNfeXml(mapDraft(a)).xml, buildNfeXml(mapDraft(b)).xml);
  assert.doesNotMatch(buildNfeXml(mapDraft(a)).xml, /vTotTrib|Tributos aproximados/);
  const explicit = preparation(); explicit.draft.items[0].origin = 1;
  assert.equal(mapDraft(explicit).approximateTaxes?.total, "3.06");
});

test("IBPT multiple item cents sum exactly and provenance is deduplicated", () => {
  const input = preparation();
  input.draft.items.push({ ...input.draft.items[0], code: "TEST-02" });
  input.draft.ibpt.items.push({ ...input.draft.ibpt.items[0] });
  input.ibptSnapshot.items.push({ ...structuredClone(input.ibptSnapshot.items[0]), itemCode: "TEST-02" });
  input.draft.productsTotal = "200.00"; input.draft.payments[0].amount = "200.00";
  input.ibptSnapshot.amounts = { federal: "2.02", state: "4.04", municipal: "0.06", total: "6.12" };
  const mapped = mapDraft(input);
  assert.deepEqual(mapped.approximateTaxes?.items, ["3.06", "3.06"]);
  assert.equal(mapped.approximateTaxes?.total, "6.12");
  assert.equal(mapped.approximateTaxes?.additionalInfo.match(/Fonte & <sintética>/g)?.length, 1);
});

test("IBPT rejects missing, tampered, misbound, expired or malformed snapshots", () => {
  const mutations: Array<(input: any) => void> = [
    i => { delete i.ibptSnapshot; }, i => { delete i.draft.ibpt; },
    i => { i.ibptSnapshot.tenantId = "22222222-2222-4222-8222-222222222222"; },
    i => { i.tenantId = "not-a-uuid"; }, i => { i.draft.ibpt.uf = "RJ"; },
    i => { i.ibptSnapshot.uf = "RJ"; }, i => { i.ibptSnapshot.items[0].metadata.uf = "RJ"; },
    i => { i.ibptSnapshot.asOf = "2026-10-18"; }, i => { i.issuedAt = "2026-10-18T04:00:00Z"; },
    i => { i.draft.ibpt.asOf = i.ibptSnapshot.asOf = "2026-02-30"; },
    i => { i.ibptSnapshot.items[0].metadata.validTo = "2026-10-16"; },
    i => { i.ibptSnapshot.items[0].metadata.validFrom = "2026-10-18"; },
    i => { i.ibptSnapshot.items[0].metadata.validFrom = "2026-02-30"; },
    i => { i.ibptSnapshot.items[0].itemCode = "OTHER"; }, i => { i.ibptSnapshot.items[0].code = "00000000"; },
    i => { i.ibptSnapshot.items[0].ex = "1"; }, i => { i.draft.ibpt.items[0].ex = "0000"; },
    i => { i.ibptSnapshot.items[0].origin = "imported"; }, i => { i.draft.ibpt.items[0].origin = "inferred"; },
    i => { i.draft.ibpt.items[0].version = "26.1.A"; }, i => { i.ibptSnapshot.items[0].metadata.version = "26.1.A"; },
    i => { i.ibptSnapshot.items = []; }, i => { i.draft.ibpt.items = []; },
    i => { i.ibptSnapshot.items[0].amount = "100.01"; },
    i => { i.ibptSnapshot.items[0].amounts.total = "3.07"; },
    i => { i.ibptSnapshot.amounts.federal = "1.02"; i.ibptSnapshot.amounts.total = "3.07"; },
    i => { i.ibptSnapshot.items[0].amounts.federal = 1.01; },
    i => { i.ibptSnapshot.items[0].amounts.federal = "-1.01"; },
    i => { i.ibptSnapshot.items[0].amounts.federal = "01.01"; },
    i => { i.ibptSnapshot.items[0].amounts.total = "10000000000000.00"; },
    i => { i.ibptSnapshot.items[0].metadata.source = "bad\u0000text"; },
    i => { i.ibptSnapshot.items[0].metadata.key = "bad\u007ftext"; },
    i => { i.ibptSnapshot.items[0].metadata.source = "x".repeat(201); },
    i => { i.ibptSnapshot.items[0].metadata.classification = "nbs"; },
    i => { i.ibptSnapshot.items[0].metadata.sha256 = "a".repeat(63); },
  ];
  mutations.forEach((mutate, index) => {
    const input = preparation(); mutate(input);
    assert.throws(() => mapDraft(input), undefined, `mutation ${index} must fail closed`);
  });
});

test("IBPT checks actual issued date in engine timezone and supports unspecified selected version", () => {
  const input = preparation(); input.issuedAt = "2026-10-18T02:59:59Z";
  delete input.draft.ibpt.items[0].version;
  assert.equal(mapDraft(input).approximateTaxes?.total, "3.06");
});

test("IBPT table UF is explicitly selected and may differ from the issuer UF", () => {
  const input = preparation();
  input.draft.ibpt.uf = input.ibptSnapshot.uf = input.ibptSnapshot.items[0].metadata.uf = "RJ";
  const mapped = mapDraft(input);
  assert.equal(mapped.issuer.uf, "SP");
  assert.match(mapped.approximateTaxes?.additionalInfo ?? "", /UF RJ/);
});

test("IBPT snapshot base includes per-item half-up IPI without changing taxes", async () => {
  const input = preparation(); input.issuer.profile.crt = 3;
  Object.assign(input.draft.items[0], { icmsCst: "00", csosn: null, pisCst: "01", cofinsCst: "01", unitPrice: "0.0500000000", grossTotal: "0.05" });
  input.draft.taxDeclaration = { recipientTaxpayer: true, recipientStateRegistration: "110042490114", finalConsumer: false, icmsRate: "18.0000", pisRate: "1.6500", cofinsRate: "7.6000", ipiCst: "50", ipiFrameCode: "999", ipiRate: "10.0000", ipiInIcmsBase: false, icmsOutOfContributions: true, ibsCbs: { cst: "000", classCode: "000001", ibsStateRate: "0.1000", ibsCityRate: "0.0000", cbsRate: "0.9000" } };
  input.draft.productsTotal = "0.05"; input.draft.payments[0].amount = "0.06";
  input.ibptSnapshot.items[0].amount = "0.06";
  assert.equal(nfeTotals(mapDraft(input)).invoice.toFixed(2), "0.06");
  input.draft.items.push({ ...input.draft.items[0], code: "TEST-02" });
  input.draft.ibpt.items.push({ ...input.draft.ibpt.items[0] });
  input.ibptSnapshot.items.push({ ...structuredClone(input.ibptSnapshot.items[0]), itemCode: "TEST-02" });
  input.draft.productsTotal = "0.10"; input.draft.payments[0].amount = "0.12";
  input.ibptSnapshot.amounts = { federal: "2.02", state: "4.04", municipal: "0.06", total: "6.12" };
  const mapped = mapDraft(input), generated = buildNfeXml(mapped);
  assert.equal(generated.totals.ipi.toFixed(2), "0.02");
  assert.equal(generated.totals.invoice.toFixed(2), "0.12");
  assert.equal(mapped.approximateTaxes?.total, "6.12");
  await assertFiscalXml(signNfeXml(generated.xml, signingKeyOf(testPfx(), "senha-de-teste")), "nfe");
  input.ibptSnapshot.items[0].amount = "0.05";
  assert.throws(() => mapDraft(input));
});

test("XML builder preserves preexisting info, escapes provenance and refuses invalid exact approximate amounts", () => {
  const input = layoutInvoice(); input.rules.additionalInfo = "Observação & <teste>";
  input.approximateTaxes = { items: ["0.10"], total: "0.10", additionalInfo: "Tributos aproximados: fonte & <sintética>" };
  const xml = buildNfeXml(input).xml;
  assert.match(xml, /<infCpl>Observação &amp; &lt;teste&gt;.*Tributos aproximados: fonte &amp; &lt;sintética&gt;<\/infCpl>/);
  for (const change of [
    { items: [], total: "0.10" }, { items: ["0.10"], total: "0.11" },
    { items: ["-0.10"], total: "-0.10" }, { items: ["0.1"], total: "0.1" },
    { items: ["10000000000000.00"], total: "10000000000000.00" },
    { additionalInfo: "x".repeat(5000) }, { additionalInfo: "bad\u0000text" },
  ]) assert.throws(() => buildNfeXml({ ...input, approximateTaxes: { ...input.approximateTaxes!, ...change } }));
});

test("IBPT rejects text controls in item bindings and unknown snapshot fields", () => {
  const input = preparation();
  input.draft.items[0].code = input.ibptSnapshot.items[0].itemCode = "TEST\u007f01";
  assert.throws(() => mapDraft(input), /IBPT|controles/i);
  const extra = preparation(); extra.ibptSnapshot.items[0].guessed = "untrusted";
  assert.throws(() => mapDraft(extra));
});

test("approximate money retains the exact NF-e upper bound and checks aggregate overflow", () => {
  const input = layoutInvoice();
  input.approximateTaxes = { items: ["9999999999999.99"], total: "9999999999999.99", additionalInfo: "Tributos aproximados: fonte sintética" };
  const xml = buildNfeXml(input).xml;
  assert.equal(xml.match(/<vTotTrib>9999999999999.99<\/vTotTrib>/g)?.length, 2);
  const snapshot = preparation();
  snapshot.ibptSnapshot.items[0].amounts = snapshot.ibptSnapshot.amounts = { federal: "9999999999999.99", state: "0.00", municipal: "0.00", total: "9999999999999.99" };
  assert.equal(mapDraft(snapshot).approximateTaxes?.total, "9999999999999.99");
  snapshot.draft.items.push({ ...snapshot.draft.items[0], code: "TEST-02" });
  snapshot.draft.ibpt.items.push({ ...snapshot.draft.ibpt.items[0] });
  snapshot.ibptSnapshot.items.push({ ...structuredClone(snapshot.ibptSnapshot.items[0]), itemCode: "TEST-02" });
  snapshot.draft.productsTotal = "200.00"; snapshot.draft.payments[0].amount = "200.00";
  assert.throws(() => mapDraft(snapshot), /limite|total/i);
});

test("IBPT refuses oversized provenance instead of truncating source identifiers", () => {
  const input = preparation();
  input.draft.items = Array.from({ length: 30 }, (_, index) => ({ ...input.draft.items[0], code: `TEST-${index}` }));
  input.draft.ibpt.items = input.draft.items.map(() => ({ ex: "0", origin: "national" }));
  input.ibptSnapshot.items = input.draft.items.map((item: any, index: number) => ({ ...structuredClone(input.ibptSnapshot.items[0]), itemCode: item.code, metadata: { ...input.ibptSnapshot.items[0].metadata, source: "x".repeat(190), key: `key-${index}` } }));
  input.draft.productsTotal = "3000.00"; input.draft.payments[0].amount = "3000.00";
  input.ibptSnapshot.amounts = { federal: "30.30", state: "60.60", municipal: "0.90", total: "91.80" };
  assert.throws(() => mapDraft(input), /5000|proveniência/i);
});
