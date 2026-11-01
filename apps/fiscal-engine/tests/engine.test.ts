import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { dispatch, mapDraft } from "../src/engine.ts";
import { createHandler } from "../src/server.ts";
import { testPfx } from "./fiscal-helpers.ts";

const key = "35261012345678000195550010000001231482917364";
const certificate = {
  pkcs12Base64: Buffer.from(testPfx({ name: "EMITENTE TESTE:12345678000195" })).toString("base64"),
  password: "senha-de-teste",
};
function preparation() {
  return {
    environment: "homologation", certificate, number: 123,
    issuedAt: "2026-10-17T13:00:00Z", randomCode: "48291736",
    issuer: { taxId: "12345678000195", company: {
      legalName: "EMITENTE TESTE", taxId: "12345678000195", state: "SP",
      postalCode: "15035000", street: "Rua de Teste", number: "1", district: "Centro", city: "São José do Rio Preto",
    }, profile: { state: "SP", municipalityCode: "3549805", stateRegistration: "110042490114", crt: 1, series: 1 } },
    draft: {
      environment: "homologation", model: 55, operationNature: "Venda de mercadoria", taxRuleReference: "instrução de teste",
      recipient: { taxId: "11222333000181", legalName: "CLIENTE TESTE", state: "SP", municipalityCode: "3549805", postalCode: "15035000", street: "Rua Teste", number: "2", district: "Centro" },
      items: [{ code: "TEST-1", description: "Produto de teste", unit: "UN", ncm: "95069100", cfop: "5102", quantity: "1.0000", unitPrice: "100.0000000000", grossTotal: "100.00", origin: 0, icmsCst: null, csosn: "102", pisCst: "07", cofinsCst: "07" }], productsTotal: "100.00", payments: [{ code: "17", description: null, amount: "100.00" }],
    },
  };
}

test("prepare maps exact draft amounts, uses IBGE name, signs and passes the pinned XSD", async () => {
  const input = preparation();
  const mapped = mapDraft(input);
  assert.equal(mapped.recipient.city, "São José do Rio Preto");
  assert.equal(mapped.issuedAt, "2026-10-17T10:00:00-03:00");
  assert.equal(mapped.items[0].unitPrice, 100);
  const result = await dispatch("prepare", input);
  assert.equal(result.accessKey, key);
  assert.match(String(result.signedXml), /<Signature /);
  assert.match(String(result.signedXml), /<vNF>100.00<\/vNF>/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE KEY|senha-de-teste|pkcs12Base64/);
});

test("prepare refuses missing tax rules, changed totals, incompatible item rules and production", () => {
  const input = preparation();
  input.issuer.profile.crt = 3;
  assert.throws(() => mapDraft(input), /recorte|regime/i);
  const wrongTotal = preparation();
  wrongTotal.draft.items[0].grossTotal = "100.01";
  assert.throws(() => mapDraft(wrongTotal), /total/i);
  const wrongCity = preparation();
  wrongCity.draft.recipient.municipalityCode = "3599999";
  assert.throws(() => mapDraft(wrongCity), /IBGE|município/i);
  const incompatible = preparation();
  incompatible.draft.items.push({ ...incompatible.draft.items[0], pisCst: "04" });
  assert.throws(() => mapDraft(incompatible), /classifica|regra/i);
});

test("engine refuses production and uncorrelated signed XML before any external call", async () => {
  let calls = 0;
  const send = async () => { calls++; return ""; };
  await assert.rejects(dispatch("authorize", { ...preparation(), environment: "production", accessKey: key, signedXml: "<NFe/>" }, send), /homologa/i);
  await assert.rejects(dispatch("authorize", { ...preparation(), accessKey: key, signedXml: "<NFe/>" }, send), /XML|assinad/i);
  assert.equal(calls, 0);
});

test("distribution uses fixed national endpoint and preserves the returned NSU batch", async () => {
  const result = await dispatch("distribute", { environment: "homologation", certificate, issuerTaxId: "12345678000195", lastNsu: "0" }, async (url, action, envelope) => {
    assert.match(url, /^https:\/\/hom1\.nfe\.fazenda\.gov\.br\//);
    assert.match(action, /nfeDistDFeInteresse$/);
    assert.match(envelope, /<ultNSU>000000000000000<\/ultNSU>/);
    return '<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe"><cStat>137</cStat><xMotivo>Sem documentos</xMotivo><ultNSU>000000000000000</ultNSU><maxNSU>000000000000000</maxNSU></retDistDFeInt>';
  });
  assert.equal(result.code, "137");
  assert.equal(result.lastNsu, "000000000000000");
  assert.deepEqual(result.documents, []);
});

test("authorization verifies the signed content, duplicates require reconciliation and A1 rotation permits consultation", async () => {
  const input = preparation();
  const prepared = await dispatch("prepare", input);
  const signed = String(prepared.signedXml);
  const digest = /<DigestValue>([^<]+)<\/DigestValue>/.exec(signed)![1];
  let sends = 0;
  const protocol = `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>test</verAplic><chNFe>${key}</chNFe><dhRecbto>2026-10-17T10:00:01-03:00</dhRecbto><nProt>135260000000001</nProt><digVal>${digest}</digVal><cStat>100</cStat><xMotivo>Autorizado</xMotivo></infProt></protNFe>`;
  const response = await dispatch("authorize", { environment: "homologation", certificate, accessKey: key, signedXml: signed }, async () => { sends++; return `<retEnviNFe><cStat>104</cStat>${protocol}</retEnviNFe>`; });
  assert.equal(response.status, "authorized"); assert.match(String(response.xml), /<nfeProc /);
  const tampered = signed.replace("<vProd>100.00</vProd>", "<vProd>100.01</vProd>");
  assert.notEqual(tampered, signed);
  await assert.rejects(dispatch("authorize", { environment: "homologation", certificate, accessKey: key, signedXml: tampered }, async () => { sends++; return ""; }));
  assert.equal(sends, 1);
  const duplicate = await dispatch("authorize", { environment: "homologation", certificate, accessKey: key, signedXml: signed }, async () => "<retEnviNFe><cStat>204</cStat><xMotivo>Duplicidade</xMotivo></retEnviNFe>");
  assert.equal(duplicate.status, "unknown");
  const replacement = { pkcs12Base64: Buffer.from(testPfx({ name: "EMITENTE TESTE:12345678000195" })).toString("base64"), password: "senha-de-teste" };
  const consulted = await dispatch("consult", { environment: "homologation", certificate: replacement, accessKey: key, signedXml: signed }, async () => `<retConsSitNFe><tpAmb>2</tpAmb><cStat>100</cStat><chNFe>${key}</chNFe>${protocol}</retConsSitNFe>`);
  assert.equal(consulted.status, "authorized"); assert.deepEqual(consulted.events, []);
});

test("inutilization retains the exact signed request and the actual correlated authority receipt", async () => {
  const result = await dispatch("void", { environment: "homologation", certificate, state: "SP", issuerTaxId: "12345678000195", year: 2026, series: 1, first: 124, last: 125, text: "Numeração não utilizada no sistema" }, async (_url, _action, envelope) => {
    assert.match(envelope, /<nNFIni>124<\/nNFIni><nNFFin>125<\/nNFFin>/);
    return '<retInutNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><infInut><tpAmb>2</tpAmb><cStat>102</cStat><xMotivo>Homologado</xMotivo><cUF>35</cUF><ano>26</ano><CNPJ>12345678000195</CNPJ><mod>55</mod><serie>1</serie><nNFIni>124</nNFIni><nNFFin>125</nNFFin><nProt>135260000000002</nProt></infInut></retInutNFe>';
  });
  assert.equal(result.registered, true);
  assert.match(String(result.xml), /<procInutNFe /);
  assert.match(String(result.xml), /<retInutNFe /);
  assert.match(String(result.xml), /<cStat>102<\/cStat>/);
});

test("HTTP boundary authenticates, bounds requests and never reflects secrets", async () => {
  const server = createServer(createHandler("test-token-with-enough-entropy"));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/v1/prepare`;
  try {
    assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 401);
    const headers = { authorization: "Bearer test-token-with-enough-entropy", "content-type": "application/json" };
    const result = await fetch(url, { method: "POST", headers, body: JSON.stringify({ environment: "production", certificate }) });
    assert.equal(result.status, 200);
    assert.doesNotMatch(await result.text(), /senha-de-teste|pkcs12Base64/);
    const oversized = await fetch(url, { method: "POST", headers, body: JSON.stringify({ xml: "x".repeat(2_100_000) }) });
    assert.equal(oversized.status, 413);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
