import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { queryCteDistribution } from "../src/lib/fiscal/cte-distribution-client.ts";
import { dispatch } from "../src/engine.ts";
import { createHandler } from "../src/server.ts";
import { testPfx } from "./fiscal-helpers.ts";

const password = "senha-de-teste";
const certificate = { pfx: Buffer.from(testPfx({ name: "TESTE:12345678000195", password })), passphrase: password };
const request = { environment: "homologation" as const, authorState: "SP", companyTaxId: "12345678000195", lastNsu: "0" };
const reply = '<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/cte" versao="1.00"><tpAmb>2</tpAmb><verAplic>teste</verAplic><cStat>137</cStat><xMotivo>Nenhum documento localizado</xMotivo><dhResp>2026-11-03T09:00:00</dhResp><ultNSU>000000000000000</ultNSU><maxNSU>000000000000000</maxNSU></retDistDFeInt>';
const soapReply = `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><cteDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe"><cteDistDFeInteresseResult>${reply}</cteDistDFeInteresseResult></cteDistDFeInteresseResponse></s:Body></s:Envelope>`;

test("CT-e client validates the request before fixed-endpoint mTLS and validates the returned SOAP payload", async () => {
  let sent = 0;
  const result = await queryCteDistribution(request, certificate, async (url, action, xml, material) => {
    sent++;
    assert.equal(url, "https://hom1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx");
    assert.equal(action, "http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe/cteDistDFeInteresse");
    assert.match(xml, /<cteDistDFeInteresse xmlns="http:\/\/www\.portalfiscal\.inf\.br\/cte\/wsdl\/CTeDistribuicaoDFe"><cteDadosMsg><distDFeInt/);
    assert.doesNotMatch(xml, /<\?xml[\s\S]*<\?xml|nfeDadosMsg|cteCabecMsg/);
    assert.equal(material, certificate);
    return soapReply;
  });
  assert.equal(sent, 1);
  assert.equal(result.code, "137");
  assert.equal(result.nextNsu, "000000000000000");
  assert.equal(result.minimumWaitSeconds, 3600);
  assert.equal(result.rawXml, soapReply);
  assert.doesNotMatch(JSON.stringify(result), /senha-de-teste|pkcs12Base64|PRIVATE KEY/);
});

test("CT-e client refuses production, invalid requests, expired or unrelated certificates before transmission", async () => {
  let sent = 0;
  const send = async () => { sent++; return soapReply; };
  await assert.rejects(() => queryCteDistribution({ ...request, environment: "production" }, certificate, send), /homologa/i);
  await assert.rejects(() => queryCteDistribution({ ...request, authorState: "XX" }, certificate, send), /UF/i);
  await assert.rejects(() => queryCteDistribution({ ...request, companyTaxId: "11222333000181" }, certificate, send), /certificado|CNPJ/i);
  const expired = { pfx: Buffer.from(testPfx({ name: "TESTE:12345678000195", until: new Date("2020-01-01") })), passphrase: password };
  await assert.rejects(() => queryCteDistribution(request, expired, send), /certificado|vencido/i);
  assert.equal(sent, 0);
});

test("CT-e client refuses an incomplete or different-environment batch without turning it into an empty success", async () => {
  await assert.rejects(() => queryCteDistribution(request, certificate, async () => soapReply.replace('<tpAmb>2</tpAmb>', '<tpAmb>1</tpAmb>')), /ambiente/i);
  await assert.rejects(() => queryCteDistribution(request, certificate, async () => soapReply.replace('<dhResp>2026-11-03T09:00:00</dhResp>', '')), /leiaute|retorno|schema/i);
});

test("private engine exposes CT-e distribution separately from NF-e and keeps production blocked", async () => {
  const input = { environment: "homologation", issuerTaxId: request.companyTaxId, authorState: "SP", lastNsu: "0", certificate: { pkcs12Base64: certificate.pfx.toString("base64"), password } };
  let sent = 0;
  const send = async () => { sent++; return soapReply; };
  const result = await dispatch("distribute-cte", input, send);
  assert.equal(result.code, "137");
  await assert.rejects(() => dispatch("distribute-cte", { ...input, environment: "production" }, send), /homologa/i);
  assert.equal(sent, 1);
});

test("private CT-e route requires engine authentication and validates JSON before any certificate or network access", async () => {
  const token = "synthetic-cte-engine-token-12345";
  const server = createServer(createHandler(token));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/v1/distribute-cte`;
  try {
    const denied = await fetch(url, { method: "POST" });
    assert.equal(denied.status, 401);
    const invalid = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ environment: "production" }) });
    assert.equal(invalid.status, 200);
    assert.equal((await invalid.json()).status, "blocked");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
