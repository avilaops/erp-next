import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { buildCteDistributionRequest, parseCteDistributionResponse } from "../src/lib/fiscal/cte-distribution.ts";
import { assertCteDistributionXml, readCteDistributionSchemas } from "../src/lib/fiscal/cte-distribution-layout.ts";

const namespace = "http://www.portalfiscal.inf.br/cte";
const context = { environment: "homologation" as const, lastNsu: "10" };
const nsu = (value: number) => String(value).padStart(15, "0");
const documentXml = `<?xml version="1.0" encoding="UTF-8"?>\n<cteProc xmlns="${namespace}" versao="4.00"><CTe/></cteProc>\n`;
const pack = (xml: string) => gzipSync(xml).toString("base64");
const zipped = (value = 11, xml = documentXml, schema = "procCTe_v4.00.xsd") => `<docZip NSU="${nsu(value)}" schema="${schema}">${pack(xml)}</docZip>`;
function response({ code = "138", last = 11, max = 20, docs = zipped(), environment = "2" } = {}) {
  return `<retDistDFeInt xmlns="${namespace}" versao="1.00"><tpAmb>${environment}</tpAmb><verAplic>teste</verAplic><cStat>${code}</cStat><xMotivo>Consulta &amp; teste</xMotivo><dhResp>2026-11-03T09:00:00</dhResp><ultNSU>${nsu(last)}</ultNSU><maxNSU>${nsu(max)}</maxNSU>${docs ? `<loteDistDFeInt>${docs}</loteDistDFeInt>` : ""}</retDistDFeInt>`;
}

test("CT-e request uses distribution 1.00, the actor's UF and an independent padded NSU", () => {
  const xml = buildCteDistributionRequest({ environment: "homologation", authorState: "RJ", companyTaxId: "12345678000195", lastNsu: "10" });
  assert.match(xml, /<distDFeInt xmlns="http:\/\/www\.portalfiscal\.inf\.br\/cte" versao="1.00">/);
  assert.match(xml, /<tpAmb>2<\/tpAmb><cUFAutor>33<\/cUFAutor><CNPJ>12345678000195<\/CNPJ>/);
  assert.match(xml, /<distNSU><ultNSU>000000000000010<\/ultNSU><\/distNSU>/);
  assert.doesNotMatch(xml, /portalfiscal\.inf\.br\/nfe|cUFAutor>91/);
  assert.match(buildCteDistributionRequest({ environment: "production", authorState: "SP", companyTaxId: "12345678000195", lastNsu: "0" }), /<tpAmb>1<\/tpAmb>/);
});

test("CT-e request refuses invalid jurisdiction, environment, tax id and NSU instead of inferring defaults", () => {
  const valid = { environment: "homologation" as const, authorState: "SP", companyTaxId: "12345678000195", lastNsu: "0" };
  for (const patch of [{ authorState: "XX" }, { authorState: "sp" }, { environment: "other" }, { companyTaxId: "1234567800019X" }, { companyTaxId: "00000000000000" }, { companyTaxId: "12345678000196" }, { lastNsu: "-1" }, { lastNsu: "1000000000000000" }, { lastNsu: "1</ultNSU>" }]) {
    assert.throws(() => buildCteDistributionRequest({ ...valid, ...patch } as typeof valid), /CT-e|NSU|CNPJ|ambiente|UF/i);
  }
});

test("CT-e batch preserves XML byte content and exposes a next cursor only for a coherent successful response", () => {
  const result = parseCteDistributionResponse(response(), context);
  assert.equal(result.code, "138");
  assert.equal(result.reason, "Consulta & teste");
  assert.equal(result.nextNsu, nsu(11));
  assert.equal(result.maxNsu, nsu(20));
  assert.deepEqual(result.documents, [{ nsu: nsu(11), schema: "procCTe_v4.00.xsd", kind: "full", xml: documentXml }]);
});

test("CT-e parser reads a namespaced SOAP response without accepting an NF-e response", () => {
  const payload = response().replace('<retDistDFeInt xmlns=', '<c:retDistDFeInt xmlns:c=').replace('</retDistDFeInt>', '</c:retDistDFeInt>').replace('versao="1.00">', `versao="1.00" xmlns="${namespace}">`);
  const soap = `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body>${payload}</s:Body></s:Envelope>`;
  assert.equal(parseCteDistributionResponse(soap, context).nextNsu, nsu(11));
  assert.throws(() => parseCteDistributionResponse(response().replaceAll(namespace, "http://www.portalfiscal.inf.br/nfe"), context), /CT-e|namespace/i);
});

test("CT-e events and unknown schemas are preserved without masquerading as a full transport document", () => {
  const event = `<procEventoCTe xmlns="${namespace}" versao="4.00"><eventoCTe/></procEventoCTe>`;
  const future = `<novoDocumento xmlns="${namespace}"/>`;
  const result = parseCteDistributionResponse(response({ last: 13, docs: zipped(11) + zipped(12, event, "procEventoCTe_v4.00.xsd") + zipped(13, future, "novoDocumento_v1.00.xsd") }), context);
  assert.deepEqual(result.documents.map(({ kind }) => kind), ["full", "event", "unrecognized"]);
  assert.equal(result.documents[2].xml, future);
});

test("CT-e schema labels cannot relabel an NF-e or unrelated XML root as a CT-e", () => {
  for (const xml of [`<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"/>`, `<outraCoisa xmlns="${namespace}"/>`]) {
    assert.throws(() => parseCteDistributionResponse(response({ docs: zipped(11, xml) }), context), /CT-e|schema|documento/i);
  }
});

test("empty CT-e distribution is valid while rejection and consumption blocks never propose a cursor commit", () => {
  const empty = parseCteDistributionResponse(response({ code: "137", last: 10, max: 10, docs: "" }), context);
  assert.equal(empty.nextNsu, nsu(10));
  assert.deepEqual(empty.documents, []);
  for (const code of ["656", "280", "999"]) {
    const rejected = parseCteDistributionResponse(response({ code, last: 0, max: 0, docs: "" }), context);
    assert.equal(rejected.nextNsu, null);
    assert.deepEqual(rejected.documents, []);
  }
});

test("CT-e parser refuses response ambiguity, wrong environment and inconsistent success statuses", () => {
  const invalid = [
    response({ environment: "1" }),
    response({ code: "137" }),
    response({ code: "656" }),
    response({ docs: "" }),
    response().replace('<cStat>138</cStat>', '<cStat>138</cStat><cStat>137</cStat>'),
    response().replace('<tpAmb>2</tpAmb>', ''),
    response().replace('versao="1.00"', 'versao="1.01"'),
    `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body>${response()}${response()}</s:Body></s:Envelope>`,
    `<arbitrary>${response()}</arbitrary>`,
    response().replace('<cStat>138</cStat>', '<cStat xmlns="urn:foreign">138</cStat>'),
  ];
  for (const xml of invalid) assert.throws(() => parseCteDistributionResponse(xml, context), /CT-e|ambiente|retorno|lote|documento|namespace|versão/i);
});

test("CT-e batch refuses repeated, regressive, unordered and out-of-range NSUs before returning documents", () => {
  const invalid = [
    response({ last: 9, max: 20, docs: zipped(9) }),
    response({ last: 11, max: 10 }),
    response({ docs: zipped(10) }),
    response({ docs: zipped(12) }),
    response({ docs: zipped(11) + zipped(11) }),
    response({ last: 12, docs: zipped(12) + zipped(11) }),
    response().replace(`NSU="${nsu(11)}"`, 'NSU="11"'),
    response().replace(`<ultNSU>${nsu(11)}</ultNSU>`, '<ultNSU>invalid</ultNSU>'),
  ];
  for (const xml of invalid) assert.throws(() => parseCteDistributionResponse(xml, context), /NSU|CT-e/i);
});

test("CT-e parser rejects DTD, entities, malformed XML, invalid UTF-8 and non-gzip content", () => {
  const invalid = [
    `<!DOCTYPE x [<!ENTITY ext SYSTEM "file:///etc/passwd">]>${response()}`,
    response().replace('</retDistDFeInt>', ''),
    response({ docs: zipped(11, '<!DOCTYPE x [<!ENTITY y "z">]><cteProc/>') }),
    response({ docs: zipped(11, `<cteProc xmlns="${namespace}">`) }),
    response().replace(pack(documentXml), Buffer.from("plain xml").toString("base64")),
    response().replace(pack(documentXml), gzipSync(Buffer.from([0xff, 0xfe])).toString("base64")),
    response().replace(pack(documentXml), "not-base64!"),
    response({ docs: zipped(11, `<cteProc xmlns="${namespace}">\u0000</cteProc>`) }),
  ];
  for (const xml of invalid) assert.throws(() => parseCteDistributionResponse(xml, context), /CT-e|XML|compact|base64|UTF/i);
});

test("CT-e parser enforces batch count, inflated document and cumulative size limits", () => {
  assert.throws(() => parseCteDistributionResponse(response({ last: 61, max: 61, docs: Array.from({ length: 51 }, (_, i) => zipped(i + 11)).join("") }), context), /50|limite|lote/i);
  const large = `<cteProc xmlns="${namespace}">${"x".repeat(2_097_152)}</cteProc>`;
  assert.throws(() => parseCteDistributionResponse(response({ docs: zipped(11, large) }), context), /limite|compact|tamanho/i);
  const medium = `<cteProc xmlns="${namespace}">${"x".repeat(1_800_000)}</cteProc>`;
  assert.throws(() => parseCteDistributionResponse(response({ last: 15, docs: Array.from({ length: 5 }, (_, i) => zipped(i + 11, medium)).join("") }), context), /limite|lote|tamanho/i);
});

test("CT-e parser rejects forbidden XML characters expressed as references before proposing a cursor", () => {
  for (const character of ["&#0;", "&#1;", "&#xD800;", "&#x110000;", "&#xFFFE;", "\uFFFE"]) {
    assert.throws(() => parseCteDistributionResponse(response({ docs: zipped(11, `<cteProc xmlns="${namespace}">${character}</cteProc>`) }), context), /XML|caracter|CT-e/i);
  }
  const literal = `<cteProc xmlns="${namespace}"><!-- &#0; --><![CDATA[&#1;]]><texto>&amp;#0; &#x1F600; &#9;</texto></cteProc>`;
  assert.equal(parseCteDistributionResponse(response({ docs: zipped(11, literal) }), context).documents[0].xml, literal);
});

test("CT-e requests and batch envelopes validate offline against the pinned official distribution package", async () => {
  const xml = buildCteDistributionRequest({ environment: "homologation", authorState: "SP", companyTaxId: "12345678000195", lastNsu: "10" });
  await assertCteDistributionXml(xml, "request");
  await assertCteDistributionXml(response(), "response");
  await assert.rejects(() => assertCteDistributionXml(xml.replace('<cUFAutor>35</cUFAutor>', '<cUFAutor>91</cUFAutor>'), "request"), /leiaute|schema|CT-e/i);
  await assert.rejects(() => assertCteDistributionXml(response().replace('<tpAmb>2</tpAmb>', ''), "response"), /leiaute|schema|CT-e/i);
});

test("CT-e schema tampering or a missing package fails closed without exposing file-reader errors", async () => {
  await assert.rejects(() => readCteDistributionSchemas(async () => "tampered schema"), /indisponível/i);
  await assert.rejects(() => readCteDistributionSchemas(async () => { throw new Error("private-path-secret"); }), (error: unknown) => /indisponível/i.test(String(error)) && !String(error).includes("private-path-secret"));
});
