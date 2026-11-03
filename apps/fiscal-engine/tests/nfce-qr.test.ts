import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { test } from "node:test";
import { SignedXml } from "xml-crypto";
import { assertFiscalXml } from "@/lib/fiscal/local-layout";
import { buildNfeXml } from "@/lib/fiscal/nfe";
import { signingKeyOf, signNfeXml } from "@/lib/fiscal/sign";
import { testPfx } from "./fiscal-helpers.ts";
import { layoutInvoice } from "./fiscal-layout-fixture.ts";
import { qrInvoice } from "./nfce-qr-fixture.ts";
import { createNfceQrPayload, NfceQrError } from "@/lib/fiscal/nfce-qr";
import type { NfceQrProfile } from "@/lib/fiscal/nfce-qr";

const key = signingKeyOf(testPfx(), "senha-de-teste");
const otherKey = signingKeyOf(testPfx(), "senha-de-teste");
const csc = { id: "000001", secret: "0123456789ABCDEF0123456789ABCDEF" };
const version2: NfceQrProfile = { version: "2", csc };
const invalid = (error: unknown) => error instanceof NfceQrError && error.reason === "invalid";

test("QR: aceita raiz e assinatura XMLDSig com prefixos sem reescrever os bytes assinados", async () => {
  const { xml, accessKey } = qrInvoice(key);
  for (const prefixRoot of [false, true]) {
    let unsigned = xml.replace(/<Signature[\s\S]*?<\/Signature>/, "");
    if (prefixRoot) unsigned = unsigned.replace('<NFe xmlns=', '<n:NFe xmlns:n="http://www.portalfiscal.inf.br/nfe" xmlns=').replace('</NFe>', '</n:NFe>');
    const signer = new SignedXml({
      privateKey: key.privateKeyPem,
      publicCert: `-----BEGIN CERTIFICATE-----\n${key.certificateBase64}\n-----END CERTIFICATE-----`,
      canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
      signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    });
    signer.addReference({ xpath: "//*[local-name()='infNFe']", transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    ], digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1" });
    signer.computeSignature(unsigned, { prefix: "ds" });
    const prefixed = signer.getSignedXml();
    await assertFiscalXml(prefixed, "nfe");
    const result = await createNfceQrPayload({ signedXml: prefixed, profile: { version: "3" } });
    assert.equal(result.payload, `${accessKey}|3|2`);
    assert.equal(result.sourceSha256, createHash("sha256").update(prefixed, "utf8").digest("hex"));
    await assert.rejects(() => createNfceQrPayload({ signedXml: prefixed.replace("<vNF>60.90</vNF>", "<vNF>60.91</vNF>"), profile: { version: "3" } }), invalid);
  }
});

test("QR 2 online: deriva chave e ambiente do XML e omite os zeros do identificador CSC", async () => {
  for (const environment of ["homologacao", "producao"] as const) {
    const { xml, accessKey } = qrInvoice(key, { environment });
    const result = await createNfceQrPayload({ signedXml: xml, profile: version2 });
    const ambient = environment === "producao" ? "1" : "2";
    const prefix = `${accessKey}|2|${ambient}|1`;
    const expectedHash = createHash("sha1").update(prefix + csc.secret, "utf8").digest("hex").toUpperCase();
    assert.equal(result.payload, `${prefix}|${expectedHash}`);
    assert.equal(result.sourceSha256, createHash("sha256").update(xml, "utf8").digest("hex"));
    assert.equal(result.accessKey, accessKey);
    assert.equal(result.environment, environment === "producao" ? "production" : "homologation");
    assert.equal(result.mode, "online");
    assert.equal(result.version, "2");
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE KEY|0123456789ABCDEF/);
  }
});

test("QR: congela o perfil antes da validação assíncrona do XML", async () => {
  const { xml, accessKey } = qrInvoice(key);
  const profile: NfceQrProfile = { version: "2", csc: { ...csc } };
  const pending = createNfceQrPayload({ signedXml: xml, profile });
  profile.csc.id = "1|CAMPO-INJETADO";
  profile.csc.secret = "ALTERADO";
  const result = await pending;
  const prefix = `${accessKey}|2|2|1`;
  assert.equal(result.payload, `${prefix}|${createHash("sha1").update(prefix + csc.secret).digest("hex").toUpperCase()}`);

  const offline = qrInvoice(key, { emission: "9" });
  const mutableKey = { ...key };
  const signed = createNfceQrPayload({ signedXml: offline.xml, profile: { version: "3", signingKey: mutableKey } });
  mutableKey.privateKeyPem = "ALTERADO";
  const outcome = await signed;
  assert.equal(outcome.mode, "offline");
});

test("QR 2 offline: usa o dia local e o hexadecimal do TEXTO base64 do DigestValue assinado", async () => {
  const { xml, accessKey } = qrInvoice(key, { emission: "9" });
  const result = await createNfceQrPayload({ signedXml: xml, profile: version2 });
  const digest = /<DigestValue>([^<]+)<\/DigestValue>/.exec(xml)![1];
  const textHex = Buffer.from(digest, "utf8").toString("hex");
  assert.equal(textHex.length, 56);
  const prefix = `${accessKey}|2|2|02|60.90|${textHex}|1`;
  const expectedHash = createHash("sha1").update(prefix + csc.secret, "utf8").digest("hex").toUpperCase();
  assert.equal(result.payload, `${prefix}|${expectedHash}`);
  assert.equal(result.mode, "offline");
  assert.notEqual(textHex, Buffer.from(digest, "base64").toString("hex"));
});

test("QR 3 online: contém apenas chave, versão e ambiente, inclusive formas 3 e 4", async () => {
  for (const emission of ["1", "3", "4"]) {
    const { xml, accessKey } = qrInvoice(key, { emission });
    const result = await createNfceQrPayload({ signedXml: xml, profile: { version: "3" } });
    assert.equal(result.payload, `${accessKey}|3|2`);
    assert.equal(result.mode, "online");
  }
});

test("QR 3 offline: preserva CPF, CNPJ e anonimato e assina os sete parâmetros com o certificado do XML", async () => {
  for (const [recipient, suffix] of [
    ["cnpj", "1|11222333000181"], ["cpf", "2|52998224725"],
    ["anonymous", "|"], ["foreign", "3|"], ["alphanumeric", "1|12ABC34501DE35"],
  ] as const) {
    const { xml, accessKey } = qrInvoice(key, { emission: "9", recipient });
    const result = await createNfceQrPayload({ signedXml: xml, profile: { version: "3", signingKey: key } });
    const prefix = `${accessKey}|3|2|02|60.90|${suffix}`;
    assert.ok(result.payload.startsWith(prefix + "|"));
    const signature = result.payload.slice(prefix.length + 1);
    assert.match(signature, /^[A-Za-z0-9+/]+={0,2}$/);
    const publicKey = createPublicKey(`-----BEGIN CERTIFICATE-----\n${key.certificateBase64}\n-----END CERTIFICATE-----`);
    assert.equal(verify("RSA-SHA1", Buffer.from(prefix, "utf8"), publicKey, Buffer.from(signature, "base64")), true);
    assert.equal(verify("RSA-SHA1", Buffer.from(prefix + "x", "utf8"), publicKey, Buffer.from(signature, "base64")), false);
  }
});

test("QR offline: mantém centavos exatos e o maior valor de 13 inteiros sem conversão para Number", async () => {
  for (const amount of ["0.00", "0.01", "9999999999999.99"]) {
    const { xml } = qrInvoice(key, { emission: "9", amount });
    const result = await createNfceQrPayload({ signedXml: xml, profile: { version: "3", signingKey: key } });
    assert.equal(result.payload.split("|")[4], amount);
  }
});

test("QR: bloqueia adulteração, XML não assinado, NF-e 55 e divergências entre campos e chave", async () => {
  const { xml } = qrInvoice(key);
  for (const bad of [
    xml.replace("<vNF>60.90</vNF>", "<vNF>60.91</vNF>"),
    xml.replace(/<Signature[\s\S]*?<\/Signature>/, ""),
    signNfeXml(buildNfeXml(layoutInvoice()).xml, key),
    qrInvoice(key, { change: text => text.replace("<cUF>35</cUF>", "<cUF>33</cUF>") }).xml,
    qrInvoice(key, { change: text => text.replace("<nNF>123</nNF>", "<nNF>124</nNF>") }).xml,
    qrInvoice(key, { change: text => text.replace("<CNPJ>12345678000195</CNPJ>", "<CNPJ>04252011000110</CNPJ>") }).xml,
    qrInvoice(key, { change: text => text.replace("2026-10-02T23:30:00-03:00", "2026-11-02T23:30:00-03:00") }).xml,
    qrInvoice(key, { emission: "2" }).xml,
  ]) await assert.rejects(() => createNfceQrPayload({ signedXml: bad, profile: version2 }), invalid);
});

test("QR 3 offline: recusa ausência de chave e certificado ou chave privada diferentes sem expor segredos", async () => {
  const { xml } = qrInvoice(key, { emission: "9" });
  for (const profile of [
    { version: "3" }, { version: "3", signingKey: otherKey },
    { version: "3", signingKey: { ...key, privateKeyPem: otherKey.privateKeyPem } },
    { version: "3", signingKey: { ...key, privateKeyPem: "SEGREDO-PRIVADO-INVALIDO" } },
  ] as NfceQrProfile[]) {
    await assert.rejects(() => createNfceQrPayload({ signedXml: xml, profile }), error => invalid(error) && !/SEGREDO|PRIVATE KEY/.test(String(error)));
  }
});

test("QR: recusa versão implícita, perfis misturados, CSC malformado e campos desconhecidos", async () => {
  const { xml } = qrInvoice(key);
  for (const profile of [
    {}, { version: 2, csc }, { version: "4" }, { version: "2" },
    { version: "3", csc }, { version: "2", csc, signingKey: key },
    { version: "2", csc: { id: "1", secret: "curto" } },
    { version: "2", csc: { id: "1234567", secret: csc.secret } },
    { version: "2", csc: { id: "1", secret: csc.secret + "|" } },
    { version: "2", csc: { id: "1", secret: "SEU-CODIGO-CSC-CONTRIBUINTE-36-CARACTERES" } },
    { version: "2", csc: { id: "1", secret: csc.secret, extra: true } },
  ]) await assert.rejects(() => createNfceQrPayload({ signedXml: xml, profile: profile as NfceQrProfile }), invalid);
  await assert.rejects(() => createNfceQrPayload({ signedXml: xml, profile: version2, environment: "production" } as never), invalid);
});

test("QR: bloqueia XML ambíguo, DTD, entidades, encoding incompatível e entrada acima do limite", async () => {
  const { xml } = qrInvoice(key);
  for (const bad of [
    xml.replace("</NFe>", xml.slice(xml.indexOf("<infNFe "), xml.indexOf("</infNFe>") + 9) + "</NFe>"),
    xml.replace("</NFe>", xml.slice(xml.indexOf("<Signature"), xml.indexOf("</Signature>") + 12) + "</NFe>"),
    xml.replace("<NFe ", "<!DOCTYPE NFe [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><NFe "),
    xml.replace('encoding="UTF-8"', 'encoding="ISO-8859-1"'),
    xml + "\0", xml + "\ud800", "x".repeat(1_048_577),
  ]) await assert.rejects(() => createNfceQrPayload({ signedXml: bad, profile: version2 }), invalid);
});
