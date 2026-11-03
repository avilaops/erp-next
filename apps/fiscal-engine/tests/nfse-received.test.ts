import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { validateXML } from "xmllint-wasm";
import { inspectReceivedNationalNfse } from "../src/lib/fiscal/nfse-received.ts";
import { readNationalNfseSchemas } from "../src/lib/fiscal/nfse-layout.ts";
import { dispatch } from "../src/engine.ts";
import { createHandler } from "../src/server.ts";
import { nationalNfseXml, nfseKey, recipientTaxId, issuerTaxId } from "./fixtures/nfse-national.ts";

const inspect = (xml: string, company = recipientTaxId) => inspectReceivedNationalNfse({ xml, recipientTaxId: company });

test("national NFS-e 1.00 and 1.01 normalize distinct actors and preserve the source without claiming signature or current status", async () => {
  for (const version of ["1.00", "1.01"]) {
    const xml = nationalNfseXml(version);
    const result = await inspect(xml);
    assert.equal(result.source, "nfse_nacional");
    assert.equal(result.schemaVersion, version);
    assert.equal(result.accessKey, nfseKey);
    assert.equal(result.accessKey.length, 50);
    assert.equal(result.environment, "homologation");
    assert.equal(result.number, "1");
    assert.equal(result.municipalityCode, "3550308");
    assert.equal(result.issuedAt, "2026-11-03T10:00:00-03:00");
    assert.equal(result.processedAt, "2026-11-03T10:00:01-03:00");
    assert.equal(result.processingCode, "100");
    assert.deepEqual(result.issuer, { kind: "CNPJ", value: issuerTaxId, name: "Serviços & Companhia" });
    assert.deepEqual(result.provider, { kind: "CNPJ", value: issuerTaxId, name: "Prestador sintético" });
    assert.deepEqual(result.recipient, { kind: "CNPJ", value: recipientTaxId, name: "Tomador sintético" });
    assert.equal(result.serviceCode, "010101");
    assert.equal(result.serviceCents, "12345");
    assert.equal(result.netCents, "12300");
    assert.equal(result.xml, xml);
    assert.equal(result.xmlSha256, createHash("sha256").update(xml).digest("hex"));
    assert.deepEqual(result.verification, { layout: version === "1.00" ? "official_schema_valid" : "local_profile_valid", correction: version === "1.00" ? null : "nfse-1.01-dps-series-regex-v1", signature: "not_verified", currentStatus: "not_queried" });
  }
});

test("national NFS-e source environment and processing code are data, never NF-e authorization or an external operation", async () => {
  const xml = nationalNfseXml().replace("<tpAmb>2</tpAmb>", "<tpAmb>1</tpAmb>").replace("<cStat>100</cStat>", "<cStat>102</cStat>");
  let transmitted = 0;
  const result = await dispatch("inspect-nfse", { xml, recipientTaxId }, async () => { transmitted++; throw new Error("No transport allowed"); });
  assert.equal(result.environment, "production");
  assert.equal(result.processingCode, "102");
  assert.equal(transmitted, 0);
  assert.equal("authorized" in result, false);
  assert.equal("nextNsu" in result, false);
  await assert.rejects(() => dispatch("inspect-nfse", { xml, recipientTaxId, certificate: "must-not-reflect" }), /Campo desconhecido/);
});

test("NFS-e amounts remain exact beyond Number safe integer precision and accept the schema's whole monetary values", async () => {
  const large = await inspect(nationalNfseXml().replace("<vServ>123.45</vServ>", "<vServ>999999999999999.99</vServ>"));
  assert.equal(large.serviceCents, "99999999999999999");
  const zero = await inspect(nationalNfseXml().replace("<vServ>123.45</vServ>", "<vServ>0</vServ>").replace("<vLiq>123.00</vLiq>", "<vLiq>12</vLiq>"));
  assert.equal(zero.serviceCents, "0");
  assert.equal(zero.netCents, "1200");
});

test("CPF and foreign provider identities retain their type without becoming the issuer or recipient", async () => {
  const original = `<prest><CNPJ>${issuerTaxId}</CNPJ>`;
  for (const [field, kind, value] of [["CPF", "CPF", "52998224725"], ["NIF", "NIF", "FOREIGN123"], ["cNaoNIF", "no_nif", "1"]]) {
    const result = await inspect(nationalNfseXml().replace(original, `<prest><${field}>${value}</${field}>`));
    assert.deepEqual(result.provider, { kind, value, name: "Prestador sintético" });
    assert.equal(result.issuer.value, issuerTaxId);
    assert.equal(result.recipient.value, recipientTaxId);
  }
});

test("missing or unrelated recipient cannot be filled from the caller, issuer, intermediary or a foreign identifier", async () => {
  const xml = nationalNfseXml();
  await assert.rejects(() => inspect(xml, issuerTaxId), /tomador|empresa/i);
  await assert.rejects(() => inspect(xml.replace(/<toma>[\s\S]*?<\/toma>/, "")), /tomador/i);
  await assert.rejects(() => inspect(xml.replace(`<toma><CNPJ>${recipientTaxId}</CNPJ>`, '<toma><NIF>FOREIGN123</NIF>')), /tomador/i);
  for (const invalid of ["", "00000000000000", "19131243000190", "19.131.243/0001-97", "52998224725"]) await assert.rejects(() => inspect(xml, invalid), /CNPJ|tomador/i);
  await assert.rejects(() => inspect(xml.replace(`<emit><CNPJ>${issuerTaxId}</CNPJ>`, '<emit><CNPJ>00000000000000</CNPJ>')), /CNPJ|identifica/i);
  await assert.rejects(() => inspect(xml.replace(`<prest><CNPJ>${issuerTaxId}</CNPJ>`, '<prest><CPF>00000000000</CPF>')), /CPF|identifica/i);
});

test("NFS-e version, namespace, layout and actors cannot borrow the NF-e parser or silently fall back to another schema", async () => {
  const xml = nationalNfseXml();
  for (const invalid of [
    nationalNfseXml("2.00"),
    xml.replace('<DPS versao="1.01">', '<DPS versao="1.00">'),
    xml.replaceAll("http://www.sped.fazenda.gov.br/nfse", "http://www.portalfiscal.inf.br/nfe"),
    xml.replace('<NFSe xmlns=', '<NFe xmlns=').replace('</NFSe>', '</NFe>'),
    xml.replace(`Id="NFS${nfseKey}"`, 'Id="NFS' + "1".repeat(44) + '"'),
    xml.replace("<nNFSe>1</nNFSe>", ""),
    xml.replace("<vServ>123.45</vServ>", "<vServ>1.234</vServ>"),
    xml.replace("<tpAmb>2</tpAmb>", "<tpAmb>3</tpAmb>"),
    xml.replace("<nNFSe>1</nNFSe>", "<nNFSe>1</nNFSe><nNFSe>2</nNFSe>"),
  ]) await assert.rejects(() => inspect(invalid));
});

test("hostile or excessive XML fails while literal comments, CDATA, UTF-8 BOM and source line endings remain untouched", async () => {
  const xml = nationalNfseXml();
  for (const invalid of [
    '<!DOCTYPE NFSe [<!ENTITY x "forbidden">]>' + xml,
    xml.replace("Serviços &amp; Companhia", "&#0;"),
    xml.replace("Serviços &amp; Companhia", "&#1;"),
    xml.replace("Serviços &amp; Companhia", "&#xD800;"),
    xml.replace("Serviços &amp; Companhia", `texto ${String.fromCharCode(0xD800)} fim`),
    xml.replace("Serviços &amp; Companhia", `texto ${String.fromCharCode(0xDC00)} fim`),
    xml.replace("Serviços &amp; Companhia", "\u0000"),
    xml.replace('encoding="UTF-8"', 'encoding="ISO-8859-1"'),
    xml.slice(0, -12),
    " ".repeat(1_048_577),
  ]) await assert.rejects(() => inspect(invalid));
  const source = "\uFEFF" + xml.replace("Inspeção offline — sem transmissão.", '<![CDATA[Literal &#0; & <texto>]]>').replace("  <infNFSe", `  <!-- Par Unicode válido: ${String.fromCodePoint(0x1F680)} -->\n  <infNFSe`).replace(/\n/g, "\r\n");
  const result = await inspect(source);
  assert.equal(result.xml, source);
  assert.equal(result.description, "Literal &#0; & <texto>");
  assert.equal(result.xmlSha256, createHash("sha256").update(source).digest("hex"));
});

test("NFS-e schema bundles are versioned, hash-pinned and closed to missing, changed or remote files", async () => {
  for (const version of ["1.00", "1.01"]) {
    const bundle = await readNationalNfseSchemas(version);
    assert.equal(bundle.files.length, 4);
    assert.equal(bundle.entry, `NFSe_v${version}.xsd`);
    const read = (name: string) => readFile(new URL(`../src/lib/fiscal/schemas/nfse-national/${version}/${name}`, import.meta.url), "utf8");
    await assert.rejects(() => readNationalNfseSchemas(version, async name => name.startsWith("tiposSimples") ? (await read(name)) + " " : read(name)), /schema|leiaute|indisponível/i);
    await assert.rejects(() => readNationalNfseSchemas(version, async () => { throw new Error("missing"); }), /schema|leiaute|indisponível/i);
  }
  await assert.rejects(() => readNationalNfseSchemas("../../not-a-version"), /versão|schema|leiaute|indisponível/i);
});

test("NFS-e 1.01 declares the exact local series profile instead of claiming the unchanged official XSD passed", async () => {
  const raw = await readNationalNfseSchemas("1.01");
  const original = raw.files.find(file => file.fileName === "tiposSimples_v1.01.xsd")!;
  const originalHash = createHash("sha256").update(original.contents).digest("hex");
  assert.equal(originalHash, "0fd5c960367c459f7f0819000e0848175c82fd8b257d7f92d8385082faa2c52b");
  const unmodified = await validateXML({ xml: [{ fileName: "synthetic.xml", contents: nationalNfseXml() }], schema: raw.files.filter(file => file.fileName === raw.entry), preload: raw.files.filter(file => file.fileName !== raw.entry), initialMemoryPages: 256, maxMemoryPages: 1024, modifyArguments: args => ["--nonet", ...args] });
  assert.equal(unmodified.valid, false);
  assert.ok(unmodified.errors.some(error => error.message.includes("serie")));
  for (const series of ["1", "00001", "49999"]) {
    const result = await inspect(nationalNfseXml().replace("<serie>1</serie>", `<serie>${series}</serie>`));
    assert.equal(result.verification.layout, "local_profile_valid");
    assert.equal(result.verification.correction, "nfse-1.01-dps-series-regex-v1");
  }
  for (const series of ["", "123456", "ABC", "^1$", "1.1", "١"]) await assert.rejects(() => inspect(nationalNfseXml().replace("<serie>1</serie>", `<serie>${series}</serie>`)));
  const reread = await readNationalNfseSchemas("1.01");
  assert.equal(createHash("sha256").update(reread.files.find(file => file.fileName === original.fileName)!.contents).digest("hex"), originalHash);
});

test("private NFS-e inspection needs service authentication and JSON, without certificate or transmission", async () => {
  const token = "synthetic-nfse-inspection-token-123456";
  const server = createServer(createHandler(token));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/v1/inspect-nfse`;
  try {
    assert.equal((await fetch(url, { method: "POST" })).status, 401);
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    assert.equal((await fetch(url, { method: "POST", headers, body: "{" })).status, 400);
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify({ xml: nationalNfseXml(), recipientTaxId }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).accessKey, nfseKey);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
