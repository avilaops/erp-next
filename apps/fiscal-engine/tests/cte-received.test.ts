import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { createHandler } from "../src/server.ts";
import { dispatch } from "../src/engine.ts";
import { signingKeyOf } from "@/lib/fiscal/sign";
import { inspectReceivedCte, CteInspectionError } from "@/lib/fiscal/cte-received";
import { readReceivedCteSchemas } from "@/lib/fiscal/cte-received-layout";
import { testPfx } from "./fiscal-helpers.ts";
import { CTE_CARRIER, CTE_COMPANY, CTE_NFE, receivedCteFixture } from "./cte-received-fixture.ts";

const key = signingKeyOf(testPfx(), "senha-de-teste");
const inspect = (xml: string) => inspectReceivedCte({ xml, companyTaxId: CTE_COMPANY, environment: "homologation" });
const invalid = (error: unknown) => error instanceof CteInspectionError && error.reason === "invalid";

test("CT-e recebido: fixture HTTP Rust confere com a inspeção real e hash dos bytes originais", async () => {
  const base = new URL("../../api/src/http/fixtures/", import.meta.url);
  for (const name of ["cte-received", "cte-own-carrier"]) {
    const xml = await readFile(new URL(`${name}.xml`, base), "utf8");
    const expected = JSON.parse(await readFile(new URL(`${name}-inspection.json`, base), "utf8"));
    assert.deepEqual(await inspect(xml), { ...expected, xml });
  }
});

test("CT-e recebido: preserva fonte e distingue transportadora, tomador, papéis e referências sem criar vínculo", async () => {
  const fixture = receivedCteFixture(key);
  const result = await inspect(fixture.xml);
  assert.equal(result.accessKey, fixture.accessKey);
  assert.deepEqual(result.carrier, { kind: "CNPJ", value: CTE_CARRIER, name: "TRANSPORTADORA FICTICIA" });
  assert.equal(result.taker.value, CTE_COMPANY);
  assert.deepEqual(result.companyRoles, ["sender", "taker"]);
  assert.equal(result.serviceCents, "15001");
  assert.equal(result.receivableCents, "15001");
  assert.deepEqual(result.nfeReferences, [CTE_NFE]);
  assert.equal(result.xmlSha256, createHash("sha256").update(fixture.xml).digest("hex"));
  assert.equal(result.xml, fixture.xml);
  assert.equal(result.protocol.number, "135260000000123");
  assert.equal(result.protocol.code, "100");
  assert.deepEqual(result.verification, { layout: "official_schema_valid", signature: "consistent", certificateTrust: "not_verified", currentStatus: "not_queried", protocolAuthenticity: "not_verified" });
});

test("CT-e recebido: toma3 seleciona cada participante e toma4 usa sua própria identidade", async () => {
  for (const [toma, companyRole, expected] of [["0","rem","sender"],["1","exped","dispatcher"],["2","receb","receiver"],["3","dest","recipient"],["4","toma4","taker"]] as const) {
    const result = await inspect(receivedCteFixture(key, { toma, companyRole }).xml);
    assert.equal(result.taker.value, CTE_COMPANY);
    assert.deepEqual(result.companyRoles, expected === "taker" ? ["taker"] : [expected, "taker"]);
  }
  const authorized = await inspect(receivedCteFixture(key, { companyRole: "autXML" }).xml);
  assert.deepEqual(authorized.companyRoles, ["authorized_xml"]);
  assert.notEqual(authorized.taker.value, CTE_COMPANY);
  const carrier = await inspect(receivedCteFixture(key, { companyRole: "emit" }).xml);
  assert.deepEqual(carrier.companyRoles, ["carrier"]);
});

test("CT-e recebido: ausência de papel não pode ser preenchida por CNPJ informado pelo chamador", async () => {
  await assert.rejects(() => inspect(receivedCteFixture(key, { companyRole: "none" }).xml), invalid);
  const fixture = receivedCteFixture(key, { change: xml => xml.replace(/<rem>[\s\S]*?<\/rem>/, "") });
  await assert.rejects(() => inspect(fixture.xml), invalid);
});

test("CT-e recebido: detecta adulteração, protocolo trocado e divergência entre chave e campos assinados", async () => {
  const fixture = receivedCteFixture(key);
  for (const xml of [
    fixture.xml.replace("<vTPrest>150.01</vTPrest>", "<vTPrest>150.02</vTPrest>"),
    fixture.xml.replace(/<chCTe>[^<]+/, `<chCTe>${CTE_NFE}`),
    fixture.xml.replace(/<digVal>[^<]+/, "<digVal>AAAAAAAAAAAAAAAAAAAAAAAAAAA="),
    fixture.xml.replace("<infProt><tpAmb>2", "<infProt><tpAmb>1"),
    receivedCteFixture(key, { change: xml => xml.replace("<nCT>123", "<nCT>124") }).xml,
    receivedCteFixture(key, { environment: "1" }).xml,
  ]) await assert.rejects(() => inspect(xml), invalid);
});

test("CT-e recebido: valida o modal que o XSD principal ignora", async () => {
  for (const change of [
    (xml: string) => xml.replace("<RNTRC>12345678</RNTRC>", "<RNTRC>INVALIDO</RNTRC>"),
    (xml: string) => xml.replace("<modal>01</modal>", "<modal>02</modal>"),
    (xml: string) => xml.replace("<rodo>", "<outro>").replace("</rodo>", "</outro>"),
  ]) await assert.rejects(() => inspect(receivedCteFixture(key, { change }).xml), invalid);
});

test("CT-e recebido: preserva o maior valor do schema como centavos exatos", async () => {
  const result = await inspect(receivedCteFixture(key, { amount: "9999999999999.99" }).xml);
  assert.equal(result.serviceCents, "999999999999999");
});

test("CT-e recebido: complementar não exige um modal inexistente e mantém a referência CT-e distinta", async () => {
  const { xml } = receivedCteFixture(key, { documentType: "1", number: "124" });
  const result = await inspect(xml);
  assert.equal(result.documentType, "1");
  assert.deepEqual(result.nfeReferences, []);
  assert.deepEqual(result.cteReferences, ["35261011222333000181570010000001231482917360"]);
  await assert.rejects(() => inspect(receivedCteFixture(key, { documentType: "1", number: "124", change: source => source.replace("<chCTe>35261011222333000181570010000001231482917360", "<chCTe>35261011222333000181570010000001231482917361") }).xml), invalid);
});

test("CT-e recebido: substituição preserva a chave original de infCteSub para conferência", async () => {
  const { xml } = receivedCteFixture(key, { documentType: "3", number: "124", change: source => source.replace("</infCTeNorm>", "<infCteSub><chCte>35261011222333000181570010000001231482917360</chCte></infCteSub></infCTeNorm>") });
  const result = await inspect(xml);
  assert.equal(result.documentType, "3");
  assert.deepEqual(result.cteReferences, ["35261011222333000181570010000001231482917360"]);
});

test("CT-e recebido: modal aquaviário preserva NF-es por container e normaliza referências repetidas", async () => {
  for (const count of [1, 2]) {
    const change = (source: string) => source.replace("<modal>01</modal>", "<modal>03</modal>").replace("<tpServ>0</tpServ>", "<tpServ>3</tpServ>").replace(/<infDoc>[\s\S]*?<\/infDoc>/, "")
      .replace("<rodo><RNTRC>12345678</RNTRC></rodo>", `<aquav><vPrest>150.01</vPrest><vAFRMM>0.00</vAFRMM><xNavio>NAVIO FICTICIO</xNavio><direc>N</direc><irin>12345</irin>${Array.from({ length: count }, (_, index) => `<detCont><nCont>ABCD123456${index + 7}</nCont><infDoc><infNFe><chave>${CTE_NFE}</chave></infNFe></infDoc></detCont>`).join("")}</aquav>`);
    const { xml } = receivedCteFixture(key, { change });
    const result = await inspect(xml);
    assert.equal(result.modal, "03");
    assert.deepEqual(result.nfeReferences, [CTE_NFE]);
    assert.equal(result.xml, xml);
    assert.equal(result.xml.match(/<detCont>/g)!.length, count);
    await assert.rejects(() => inspect(receivedCteFixture(key, { change: source => change(source).replaceAll(CTE_NFE, CTE_NFE.slice(0, 43) + "5") }).xml), invalid);
  }
});

test("CT-e recebido: documentos anteriores e serviço multimodal preservam referências CT-e assinadas", async () => {
  const original = "35261011222333000181570010000001231482917360";
  for (const change of [
    (source: string) => source.replace("<infModal ", `<docAnt><emiDocAnt><CNPJ>11222333000181</CNPJ><IE>110042490114</IE><UF>SP</UF><xNome>TRANSPORTADORA ANTERIOR</xNome><idDocAnt><idDocAntEle><chCTe>${original}</chCTe></idDocAntEle></idDocAnt></emiDocAnt></docAnt><infModal `),
    (source: string) => source.replace("</infCTeNorm>", `<infServVinc><infCTeMultimodal><chCTeMultimodal>${original}</chCTeMultimodal></infCTeMultimodal></infServVinc></infCTeNorm>`),
  ]) {
    const result = await inspect(receivedCteFixture(key, { number: "124", change }).xml);
    assert.deepEqual(result.cteReferences, [original]);
    await assert.rejects(() => inspect(receivedCteFixture(key, { number: "124", change: source => change(source).replaceAll(original, original.slice(0, 43) + "1") }).xml), invalid);
  }
});

test("CT-e recebido: schemas locais têm closure fechada e falham se arquivo sumir ou mudar", async () => {
  const files = await readReceivedCteSchemas();
  assert.ok(files.some(file => file.fileName === "procCTe_v4.00.xsd"));
  const read = (name: string) => readFile(new URL(`../src/lib/fiscal/schemas/cte-received/${name}`, import.meta.url), "utf8");
  for (const loader of [async () => { throw new Error("CAMINHO PRIVADO"); }, async (name: string) => (await read(name)) + "<!-- mudança -->"]) {
    await assert.rejects(() => readReceivedCteSchemas(loader), error => error instanceof CteInspectionError && error.reason === "unavailable" && !String(error).includes("CAMINHO"));
  }
});

test("CT-e recebido: não aceita XML hostil, ambíguo, encoding incompatível ou formato desconhecido", async () => {
  const { xml } = receivedCteFixture(key);
  for (const source of [
    xml.replace("<cteProc ", '<!DOCTYPE cteProc [<!ENTITY x SYSTEM "file:///etc/passwd">]><cteProc '),
    xml.replace('encoding="UTF-8"', 'encoding="ISO-8859-1"'),
    xml.replace("</cteProc>", "<CTe></CTe></cteProc>"),
    xml.replace('versao="4.00" Id=', 'versao="3.00" Id='),
    xml + "\0", xml + "\ud800", "x".repeat(2_097_153),
  ]) await assert.rejects(() => inspect(source), invalid);
});

test("CT-e recebido: formatos fora do perfil são preserváveis sem serem declarados XML inválido", async () => {
  const { xml } = receivedCteFixture(key);
  await assert.rejects(() => inspect(xml.replaceAll('versao="4.00"', 'versao="3.00"')), error => error instanceof CteInspectionError && error.reason === "unsupported");
});

test("CT-e recebido: contrato privado exige autenticação e JSON sem certificado ou transporte", async () => {
  const token = "synthetic-cte-inspection-token-123456";
  const server = createServer(createHandler(token));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/v1/inspect-cte`;
  const fixture = receivedCteFixture(key);
  try {
    assert.equal((await fetch(url, { method: "POST" })).status, 401);
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    assert.equal((await fetch(url, { method: "POST", headers, body: "{" })).status, 400);
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify({ xml: fixture.xml, companyTaxId: CTE_COMPANY, environment: "homologation" }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).accessKey, fixture.accessKey);
    await assert.rejects(() => dispatch("inspect-cte", { xml: fixture.xml, companyTaxId: CTE_COMPANY, environment: "homologation", certificate: "SECRET" }), error => !String(error).includes("SECRET"));
    const blocked = await fetch(url, { method: "POST", headers, body: JSON.stringify({ xml: "<SECRET/>", companyTaxId: CTE_COMPANY, environment: "homologation" }) });
    assert.deepEqual((await blocked.json()).blockers, ["invalid_cte_xml"]);
    let transmitted = 0;
    await dispatch("inspect-cte", { xml: fixture.xml, companyTaxId: CTE_COMPANY, environment: "homologation" }, async () => { transmitted++; throw Error("No transport allowed"); });
    assert.equal(transmitted, 0);
    const expanded = fixture.xml.replace("</cteProc>", `<!--${'"'.repeat(1_200_000)}--></cteProc>`);
    const body = JSON.stringify({ xml: expanded, companyTaxId: CTE_COMPANY, environment: "homologation" });
    assert.ok(Buffer.byteLength(body) > 2_097_152);
    const large = await fetch(url, { method: "POST", headers, body });
    assert.equal(large.status, 200);
    assert.equal((await large.json()).xmlSha256, createHash("sha256").update(expanded).digest("hex"));
    assert.equal((await fetch(url.replace("inspect-cte", "inspect-nfse"), { method: "POST", headers, body })).status, 413);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
