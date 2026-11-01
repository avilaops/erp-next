import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import forge from "node-forge";
import { validateXML } from "xmllint-wasm";
import { buildNfeXml } from "@/lib/fiscal/nfe";
import type { NfeInput } from "@/lib/fiscal/nfe";
import { AUTHORIZATION_ACTION, SefazError, authorizationEnvelope, authorizationUrl, nfeProcXml, parseAuthorization, transmit } from "@/lib/fiscal/sefaz";
import { signingKeyOf, signNfeXml } from "@/lib/fiscal/sign";
import { testPfx } from "./fiscal-helpers.ts";

const INPUT: NfeInput = {
  environment: "homologacao", freightMode: "1", transport: { carrier: null, volumes: null, volumeKind: null, netWeight: null, grossWeight: null }, delivery: null, series: 1, number: 9, randomCode: "48291736", issuedAt: "2026-10-08T10:30:00-03:00",
  issuer: { cnpj: "12345678000195", legalName: "Ludus Equipamentos Ltda", stateRegistration: "110042490114", taxRegime: 3, street: "Rua das Máquinas", number: "100", district: "Distrito Industrial", cityCode: "3549805", city: "São José do Rio Preto", uf: "SP", cep: "15035000" },
  recipient: { kind: "PJ", document: "98765432000198", name: "Academia", stateRegistration: null, taxpayer: false, street: "Av. Brasil", number: "500", district: "Centro", cityCode: "2111300", city: "São Luís", uf: "MA", cep: "65000000" },
  rules: { operationNature: "Venda de mercadoria", cfopInternal: "5102", cfopInterstate: "6102", cfopInterstateNonTaxpayer: "6108", icmsCode: "00", ipiCst: null, ipiFrameCode: "999", pisCst: "01", pisRate: 0.0065, cofinsCst: "01", cofinsRate: 0.03, finalConsumer: true, ipiInIcmsBase: true, icmsOutOfContributions: false, additionalInfo: null, ibsCbs: { cst: "000", classCode: "000001", ibsStateRate: 0.001, ibsCityRate: 0, cbsRate: 0.009 } },
  items: [{ code: "LD-WH037", name: "Leg Press", ncm: "95069100", cest: null, origin: 0, unit: "UN", quantity: 2, unitPrice: 10344.12, ipiRate: 0 }],
  icmsRate: 0.07, destination: { internalIcms: 0.23, fcp: 0 }, payments: [{ code: "17", description: null, amount: 20688.24 }], software: "ERP Avila Ops",
};
const PASSWORD = "senha-de-teste";
const pfx = testPfx();
const built = buildNfeXml(INPUT);
const signed = signNfeXml(built.xml, signingKeyOf(pfx, PASSWORD));

const protocol = (code: string, reason: string, key = built.key) =>
  `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SP_NFE_PL009_V4</verAplic><chNFe>${key}</chNFe><dhRecbto>2026-10-08T10:31:02-03:00</dhRecbto>` +
  `${code === "100" || code === "302" ? "<nProt>135260000012345</nProt><digVal>abc=</digVal>" : ""}<cStat>${code}</cStat><xMotivo>${reason}</xMotivo></infProt></protNFe>`;
const answer = (inner: string) =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">` +
  `<retEnviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><verAplic>SP_NFE_PL009_V4</verAplic>${inner}</retEnviNFe></nfeResultMsg></soap:Body></soap:Envelope>`;

test("SEFAZ: só São Paulo tem endereço; outro estado é erro, não palpite", () => {
  assert.match(authorizationUrl("SP", "homologacao"), /^https:\/\/homologacao\.nfe\.fazenda\.sp\.gov\.br\//);
  assert.match(authorizationUrl("SP", "producao"), /^https:\/\/nfe\.fazenda\.sp\.gov\.br\//);
  assert.throws(() => authorizationUrl("MA", "producao"), SefazError);
});

test("SEFAZ: o envelope leva uma nota assinada, síncrona, sem a declaração do XML; nota sem assinatura não vai", () => {
  const envelope = authorizationEnvelope(signed, "1");
  assert.ok(envelope.includes('<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><idLote>1</idLote><indSinc>1</indSinc><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe'));
  assert.equal(envelope.split("<?xml").length - 1, 1);
  // A nota vai byte a byte como foi assinada.
  assert.ok(envelope.includes(signed.replace(/^<\?xml[^>]*\?>/, "")));
  assert.throws(() => authorizationEnvelope(built.xml, "1"), /assinada/);
  assert.throws(() => authorizationEnvelope(signed, "lote"), /lote/);
});

test("SEFAZ: leitura da resposta — autorizada, rejeitada com o motivo, denegada, lote recusado, serviço parado e resposta sobre outra nota", () => {
  const ok = parseAuthorization(answer(`<cStat>104</cStat><xMotivo>Lote processado</xMotivo>${protocol("100", "Autorizado o uso da NF-e")}`), built.key);
  assert.deepEqual([ok.status, ok.code, ok.status === "autorizada" && ok.protocol], ["autorizada", "100", "135260000012345"]);

  const rejected = parseAuthorization(answer(`<cStat>104</cStat><xMotivo>Lote processado</xMotivo>${protocol("539", "Rejeição: Duplicidade de NF-e, com diferença na Chave de Acesso &amp; outros")}`), built.key);
  assert.deepEqual(rejected, { status: "rejeitada", code: "539", reason: "Rejeição: Duplicidade de NF-e, com diferença na Chave de Acesso & outros" });

  assert.equal(parseAuthorization(answer(`<cStat>104</cStat><xMotivo>Lote processado</xMotivo>${protocol("302", "Uso Denegado: Irregularidade fiscal do destinatário")}`), built.key).status, "denegada");
  assert.deepEqual(parseAuthorization(answer("<cStat>215</cStat><xMotivo>Rejeição: Falha no schema XML</xMotivo>"), built.key), { status: "rejeitada", code: "215", reason: "Rejeição: Falha no schema XML" });
  assert.equal(parseAuthorization(answer("<cStat>108</cStat><xMotivo>Serviço Paralisado Momentaneamente</xMotivo>"), built.key).status, "sem-resposta");
  assert.throws(() => parseAuthorization(answer(`<cStat>104</cStat><xMotivo>Lote processado</xMotivo>${protocol("100", "Autorizado", "9".repeat(44))}`), built.key), /outra nota/);
  assert.throws(() => parseAuthorization("<html>502 Bad Gateway</html>", built.key), SefazError);
  assert.throws(() => parseAuthorization('<soap:Envelope xmlns:soap="x"><soap:Body><soap:Fault><soap:Reason><soap:Text>Certificado revogado</soap:Text></soap:Reason></soap:Fault></soap:Body></soap:Envelope>', built.key), /Certificado revogado/);
});

test("SEFAZ: o arquivo guardado (nota assinada + protocolo) passa no esquema oficial do nfeProc", async () => {
  const proc = nfeProcXml(signed, protocol("100", "Autorizado o uso da NF-e"));
  const fixture = (name: string) => readFileSync(new URL(`./fixtures/nfe-xsd/${name}`, import.meta.url), "utf8");
  const result = await validateXML({
    xml: [{ fileName: "proc.xml", contents: proc }],
    schema: [{ fileName: "procNFe_v4.00.xsd", contents: fixture("procNFe_v4.00.xsd") }],
    preload: ["leiauteNFe_v4.00.xsd", "tiposBasico_v4.00.xsd", "DFeTiposBasicos_v1.00.xsd", "xmldsig-core-schema_v1.01.xsd"].map((fileName) => ({ fileName, contents: fixture(fileName) })),
  });
  assert.deepEqual(result.errors.map((error) => error.message), []);
  assert.ok(proc.includes(signed.replace(/^<\?xml[^>]*\?>/, "")));
});

/** A certificate for `localhost`, with its key in PEM: the stand-in for SEFAZ's server. */
function serverIdentity() {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = "02";
  certificate.validity.notBefore = new Date(Date.now() - 86_400_000);
  certificate.validity.notAfter = new Date(Date.now() + 86_400_000);
  const name = [{ name: "commonName", value: "localhost" }];
  certificate.setSubject(name);
  certificate.setIssuer(name);
  certificate.setExtensions([{ name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }] }, { name: "basicConstraints", cA: true }]);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  return { key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(certificate) };
}

test("SEFAZ: a transmissão apresenta o certificado da empresa, confere o do servidor e nunca desliga a verificação", async () => {
  const identity = serverIdentity();
  // Validade de agora: o servidor de teste confere o certificado do cliente de verdade.
  const valid = { from: new Date(Date.now() - 86_400_000), until: new Date(Date.now() + 86_400_000), bits: 2048 };
  const client = testPfx(valid);
  const clientCert = `-----BEGIN CERTIFICATE-----\n${signingKeyOf(client, PASSWORD).certificateBase64}\n-----END CERTIFICATE-----`;
  const seen: { type?: string; body?: string; authorized?: boolean } = {};
  const server = createServer({ key: identity.key, cert: identity.cert, requestCert: true, rejectUnauthorized: true, ca: clientCert }, (request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      seen.type = request.headers["content-type"];
      seen.body = Buffer.concat(chunks).toString("utf8");
      response.end(answer(`<cStat>104</cStat><xMotivo>Lote processado</xMotivo>${protocol("100", "Autorizado o uso da NF-e")}`));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `https://localhost:${(server.address() as AddressInfo).port}/ws/nfeautorizacao4.asmx`;
  try {
    const envelope = authorizationEnvelope(signed, "7");
    const body = await transmit(url, AUTHORIZATION_ACTION, envelope, { pfx: Buffer.from(client), passphrase: PASSWORD, ca: identity.cert });
    assert.equal(parseAuthorization(body, built.key).status, "autorizada");
    assert.equal(seen.body, envelope);
    assert.equal(seen.type, `application/soap+xml; charset=utf-8; action="${AUTHORIZATION_ACTION}"`);

    // Servidor que não é de confiança: nada é enviado.
    seen.body = undefined;
    await assert.rejects(() => transmit(url, AUTHORIZATION_ACTION, envelope, { pfx: Buffer.from(client), passphrase: PASSWORD }), /identidade do servidor/);
    assert.equal(seen.body, undefined);
    // Certificado que o servidor não aceita: a conversa não acontece, e a mensagem não traz senha nem arquivo.
    const failure = await transmit(url, AUTHORIZATION_ACTION, envelope, { pfx: Buffer.from(testPfx(valid)), passphrase: PASSWORD, ca: identity.cert }).then(() => null, (error: Error) => error);
    assert.ok(failure instanceof SefazError);
    assert.doesNotMatch(failure.message, new RegExp(PASSWORD));
    assert.equal(seen.body, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("raiz da ICP-Brasil: é a v10 do ITI, com a impressão digital registrada, e ainda vale", async () => {
  const { X509Certificate } = await import("node:crypto");
  const { ICP_BRASIL_ROOT_V10 } = await import("@/lib/fiscal/icp-brasil");
  const root = new X509Certificate(ICP_BRASIL_ROOT_V10);
  assert.equal(root.fingerprint256, "6E:0B:FF:06:9A:26:99:4C:15:DE:2C:48:88:CC:54:AF:84:88:2E:54:95:B7:FB:F6:6B:E9:CC:FF:EC:74:89:F6");
  assert.match(root.subject, /CN=Autoridade Certificadora Raiz Brasileira v10/);
  assert.equal(root.subject, root.issuer);
  assert.ok(root.verify(root.publicKey));
  assert.ok(new Date(root.validTo).getTime() > Date.now(), "a raiz venceu: troque pela nova do ITI");
});

const fixtureOf = (name: string) => readFileSync(new URL(`./fixtures/nfe-xsd/${name}`, import.meta.url), "utf8");
async function validates(xml: string, schema: string, layout: string): Promise<string[]> {
  const result = await validateXML({
    xml: [{ fileName: "x.xml", contents: xml }],
    schema: [{ fileName: schema, contents: fixtureOf(schema) }],
    preload: [layout, "tiposBasico_v4.00.xsd", "xmldsig-core-schema_v1.01.xsd"].map((fileName) => ({ fileName, contents: fixtureOf(fileName) })),
  });
  return result.errors.map((error) => error.message);
}

test("consulta de protocolo: pedido válido no esquema oficial; resposta diz autorizada, cancelada, denegada ou que a nota não consta", async () => {
  const { consultEnvelope, consultUrl, parseConsult } = await import("@/lib/fiscal/sefaz");
  const envelope = consultEnvelope(built.key, "homologacao");
  assert.deepEqual(await validates(/<consSitNFe[\s\S]*<\/consSitNFe>/.exec(envelope)![0], "consSitNFe_v4.00.xsd", "leiauteConsSitNFe_v4.00.xsd"), []);
  assert.match(consultUrl("SP", "producao"), /nfe\.fazenda\.sp\.gov\.br\/ws\/nfeconsultaprotocolo4\.asmx$/);
  assert.throws(() => consultUrl("BA", "producao"), SefazError);

  const reply = (code: string, reason: string, extra = "") => `<soap:Envelope xmlns:soap="x"><soap:Body><retConsSitNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><verAplic>SP</verAplic><cStat>${code}</cStat><xMotivo>${reason}</xMotivo><cUF>35</cUF><chNFe>${built.key}</chNFe>${extra}</retConsSitNFe></soap:Body></soap:Envelope>`;
  const found = parseConsult(reply("100", "Autorizado o uso da NF-e", protocol("100", "Autorizado o uso da NF-e")), built.key);
  assert.deepEqual([found.status, found.status === "autorizada" && found.protocol], ["autorizada", "135260000012345"]);
  assert.equal(parseConsult(reply("101", "Cancelamento de NF-e homologado"), built.key).status, "cancelada");
  assert.equal(parseConsult(reply("217", "Rejeição: NF-e não consta na base de dados da SEFAZ"), built.key).status, "nao-consta");
  assert.equal(parseConsult(reply("302", "Uso Denegado"), built.key).status, "denegada");
  assert.equal(parseConsult(reply("656", "Rejeição: Consumo Indevido"), built.key).status, "outra");
  // Autorizada sem o protocolo da própria chave não vale como autorizada.
  assert.equal(parseConsult(reply("100", "Autorizado", protocol("100", "Autorizado", "9".repeat(44))), built.key).status, "outra");
  assert.throws(() => parseConsult("<html/>", built.key), SefazError);
});

test("inutilização: pedido assinado válido no esquema oficial, identificador de 41 dígitos, e leitura da resposta", async () => {
  const { parseVoid, voidEnvelope, voidUrl, voidXml } = await import("@/lib/fiscal/sefaz");
  const { signVoidXml } = await import("@/lib/fiscal/sign");
  const request = voidXml({ environment: "homologacao", stateCode: "35", year: "26", cnpj: "12345678000195", series: 1, first: 44, last: 46, reason: "Numeração pulada por falha de sistema & rede." });
  assert.equal(request.id, "ID35261234567800019555001000000044000000046");
  const signedRequest = signVoidXml(request.xml, signingKeyOf(pfx, PASSWORD));
  assert.deepEqual(await validates(signedRequest, "inutNFe_v4.00.xsd", "leiauteInutNFe_v4.00.xsd"), []);
  assert.ok(voidEnvelope(signedRequest).includes('<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4"><inutNFe '));
  assert.throws(() => voidEnvelope(request.xml), /assinado/);
  assert.match(voidUrl("SP", "homologacao"), /nfeinutilizacao4\.asmx$/);
  for (const wrong of [{ reason: "curto" }, { first: 50, last: 40 }, { series: 0 }]) {
    assert.throws(() => voidXml({ environment: "homologacao", stateCode: "35", year: "26", cnpj: "12345678000195", series: 1, first: 44, last: 46, reason: "Numeração pulada por falha.", ...wrong }), SefazError);
  }
  const reply = (code: string, extra = "") => `<retInutNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><infInut><tpAmb>2</tpAmb><cStat>${code}</cStat><xMotivo>motivo</xMotivo>${extra}</infInut></retInutNFe>`;
  assert.deepEqual(parseVoid(reply("102", "<nProt>135260000055555</nProt>")), { registered: true, code: "102", reason: "motivo", protocol: "135260000055555" });
  assert.deepEqual(parseVoid(reply("241")), { registered: false, code: "241", reason: "motivo" });
});
