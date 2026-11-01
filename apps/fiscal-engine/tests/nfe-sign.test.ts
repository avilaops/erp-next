import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SignedXml } from "xml-crypto";
import { validateXML } from "xmllint-wasm";
import { CertificateError } from "@/lib/fiscal/certificate";
import { buildNfeXml } from "@/lib/fiscal/nfe";
import type { NfeInput } from "@/lib/fiscal/nfe";
import { signingKeyOf, signNfeXml } from "@/lib/fiscal/sign";
import { testPfx } from "./fiscal-helpers.ts";

const INPUT: NfeInput = {
  environment: "homologacao", freightMode: "1", transport: { carrier: null, volumes: null, volumeKind: null, netWeight: null, grossWeight: null }, delivery: null, series: 1, number: 9, randomCode: "48291736", issuedAt: "2026-10-08T10:30:00-03:00",
  issuer: { cnpj: "12345678000195", legalName: "Ludus Equipamentos Ltda", stateRegistration: "110042490114", taxRegime: 3, street: "Rua das Máquinas", number: "100", district: "Distrito Industrial", cityCode: "3549805", city: "São José do Rio Preto", uf: "SP", cep: "15035000" },
  recipient: { kind: "PJ", document: "98765432000198", name: "Academia \"Força\" & Forma's <Matriz>", stateRegistration: null, taxpayer: false, street: "Av. Brasil", number: "500", district: "Centro", cityCode: "2111300", city: "São Luís", uf: "MA", cep: "65000000" },
  rules: { operationNature: "Venda de mercadoria", cfopInternal: "5102", cfopInterstate: "6102", cfopInterstateNonTaxpayer: "6108", icmsCode: "00", ipiCst: null, ipiFrameCode: "999", pisCst: "01", pisRate: 0.0065, cofinsCst: "01", cofinsRate: 0.03, finalConsumer: true, ipiInIcmsBase: true, icmsOutOfContributions: false, additionalInfo: "Aspas \"duplas\", 'simples', e comercial & acento: ação", ibsCbs: { cst: "000", classCode: "000001", ibsStateRate: 0.001, ibsCityRate: 0, cbsRate: 0.009 } },
  items: [{ code: "LD-WH037", name: "Leg Press 45° Com Suporte", ncm: "95069100", cest: null, origin: 0, unit: "UN", quantity: 2, unitPrice: 10344.12, ipiRate: 0 }],
  icmsRate: 0.07, destination: { internalIcms: 0.23, fcp: 0 }, payments: [{ code: "17", description: null, amount: 20688.24 }], software: "ERP Avila Ops",
};
// Em produção, para o nome do cliente (com aspas, & e <) entrar na nota e na assinatura.
const PRODUCTION: NfeInput = { ...INPUT, environment: "producao" };

const PASSWORD = "senha-de-teste";
const pfx = testPfx();
const key = signingKeyOf(pfx, PASSWORD);
const fixture = (name: string) => readFileSync(new URL(`./fixtures/nfe-xsd/${name}`, import.meta.url), "utf8");

test("assinatura: a nota assinada passa inteira no esquema oficial, sem nenhuma pendência", async () => {
  for (const input of [INPUT, PRODUCTION]) {
    const signed = signNfeXml(buildNfeXml(input).xml, key);
    const result = await validateXML({
      xml: [{ fileName: "nota.xml", contents: signed }],
      schema: [{ fileName: "nfe_v4.00.xsd", contents: fixture("nfe_v4.00.xsd") }],
      preload: ["leiauteNFe_v4.00.xsd", "tiposBasico_v4.00.xsd", "DFeTiposBasicos_v1.00.xsd", "xmldsig-core-schema_v1.01.xsd"].map((fileName) => ({ fileName, contents: fixture(fileName) })),
    });
    assert.deepEqual(result.errors.map((error) => error.message), []);
  }
});

/** Confere com outra implementação (xml-crypto): canonicalização, resumo e assinatura refeitos do zero. */
function verifies(signed: string): boolean {
  const signature = /<Signature xmlns="http:\/\/www.w3.org\/2000\/09\/xmldsig#">[\s\S]*<\/Signature>/.exec(signed)?.[0];
  if (!signature) return false;
  const checker = new SignedXml({ publicCert: `-----BEGIN CERTIFICATE-----\n${key.certificateBase64}\n-----END CERTIFICATE-----` });
  checker.loadSignature(signature);
  try {
    return checker.checkSignature(signed);
  } catch {
    return false;
  }
}

test("assinatura: confere em implementação independente, com aspas, &, < e acentos no texto", () => {
  for (const input of [INPUT, PRODUCTION]) {
    const signed = signNfeXml(buildNfeXml(input).xml, key);
    assert.equal(verifies(signed), true);
    assert.ok(signed.includes(`<Reference URI="#NFe${buildNfeXml(input).key}">`));
  }
});

test("assinatura: qualquer alteração depois de assinar invalida a nota", () => {
  const signed = signNfeXml(buildNfeXml(PRODUCTION).xml, key);
  assert.equal(verifies(signed.replace("<vNF>20688.24</vNF>", "<vNF>20688.25</vNF>")), false);
  assert.equal(verifies(signed.replace("<CFOP>6108</CFOP>", "<CFOP>6102</CFOP>")), false);
});

test("assinatura: só assina o XML que este sistema monta; certificado sem chave ou com senha errada é recusado", () => {
  assert.throws(() => signNfeXml("<NFe><infNFe/></NFe>", key), /não é o que este sistema monta/);
  assert.throws(() => signNfeXml(buildNfeXml(INPUT).xml.replace("<transp>", "<!-- x --><transp>"), key), /forma canônica/);
  assert.throws(() => signingKeyOf(pfx, "senha-errada"), CertificateError);
  assert.throws(() => signingKeyOf(testPfx({ withKey: false }), PASSWORD), CertificateError);
  // A chave privada não aparece no XML assinado.
  const signed = signNfeXml(buildNfeXml(INPUT).xml, key);
  assert.doesNotMatch(signed, /PRIVATE KEY/);
});
