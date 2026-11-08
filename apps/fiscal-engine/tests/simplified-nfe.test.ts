import assert from "node:assert/strict";
import { test } from "node:test";
import { accessKeyDigit, buildNfeXml } from "@/lib/fiscal/nfe";
import { verify, X509Certificate } from "node:crypto";
import { signNfeXml, signingKeyOf } from "@/lib/fiscal/sign";
import { assertFiscalXml } from "@/lib/fiscal/local-layout";
import { layoutInvoice } from "./fiscal-layout-fixture.ts";
import { testPfx } from "./fiscal-helpers.ts";
import { supplementSimplifiedNfe } from "@/lib/fiscal/simplified-nfe";

const key = signingKeyOf(testPfx(), "senha-de-teste");
// Deliberately synthetic configuration; these URLs are not endpoint defaults.
const endpoints = { qrCodeUrl: "https://teste.sefaz.gov.br/nfe/qrcode", accessKeyUrl: "https://teste.sefaz.gov.br/nfe/consulta" };
function invoice(tpImp = "6") {
  const built = buildNfeXml({ ...layoutInvoice(), freightMode: "9" });
  return signNfeXml(built.xml.replace(/<tpImp>\d<\/tpImp>/, `<tpImp>${tpImp}</tpImp>`).replace(/<indPres>\d<\/indPres>/, "<indPres>1</indPres>"), key);
}
test("NF-e simplificada: QR v3 vinculado ao XML e suplemento mantém assinatura", async () => {
  const first = await supplementSimplifiedNfe({ signedXml: invoice(), endpoints });
  assert.equal(first.accessKey.slice(20, 22), "55");
  assert.equal(first.payload, `${first.accessKey}|3|2`);
  assert.equal(new URL(first.qrCodeUrl).searchParams.get("p"), first.payload);
  await assertFiscalXml(first.xml, "nfe");
  const second = await supplementSimplifiedNfe({ signedXml: first.xml, endpoints });
  assert.equal(second.payload, first.payload);
  assert.equal((second.xml.match(/<infNFeSupl>/g) ?? []).length, 1);
});
test("NF-e simplificada: rejeita paisagem, XML adulterado e URL sem configuração oficial", async () => {
  await assert.rejects(supplementSimplifiedNfe({ signedXml: invoice("2"), endpoints }));
  await assert.rejects(supplementSimplifiedNfe({ signedXml: invoice().replace("<vNF>100.00", "<vNF>101.00"), endpoints }));
  await assert.rejects(supplementSimplifiedNfe({ signedXml: invoice(), endpoints: { ...endpoints, qrCodeUrl: "https://example.com" } }));
});
test("NF-e simplificada: aplica elegibilidade da NT 2026.002 v1.11 ao XML assinado", async () => {
  const built = buildNfeXml({ ...layoutInvoice(), freightMode: "9" }).xml.replace(/<tpImp>\d<\/tpImp>/, "<tpImp>6</tpImp>").replace(/<indPres>\d<\/indPres>/, "<indPres>1</indPres>");
  for (const [from, to] of [
    ["<indPres>1</indPres>", "<indPres>9</indPres>"],
    ["<indFinal>1</indFinal>", "<indFinal>0</indFinal>"],
    ["<idDest>1</idDest>", "<idDest>2</idDest>"],
    ["<tpNF>1</tpNF>", "<tpNF>0</tpNF>"],
    ["<finNFe>1</finNFe>", "<finNFe>4</finNFe>"],
    ["</ide>", "<NFref><refNFe>35261012345678000195550010000001231482917364</refNFe></NFref></ide>"],
    ["<tpNF>", "<dhSaiEnt>2026-10-17T10:00:00-03:00</dhSaiEnt><tpNF>"],
    ["<CFOP>5102</CFOP>", "<CFOP>5901</CFOP>"],
    ["<modFrete>9</modFrete>", "<modFrete>0</modFrete>"],
    ["<vNF>100.00</vNF>", "<vNF>200000.01</vNF>"],
    ["</transp>", "<veicTransp><placa>ABC1234</placa><UF>SP</UF></veicTransp></transp>"],
  ]) {
    assert.notEqual(built.replace(from, to), built);
    await assert.rejects(supplementSimplifiedNfe({ signedXml: signNfeXml(built.replace(from, to), key), endpoints }));
  }
});
test("NF-e simplificada offline: assina os sete parâmetros com o mesmo certificado", async () => {
  const built = buildNfeXml({ ...layoutInvoice(), freightMode: "9" });
  const partial = built.key.slice(0, 34) + "9" + built.key.slice(35, 43);
  const accessKey = partial + accessKeyDigit(partial);
  const xml = built.xml.replaceAll(built.key, accessKey)
    .replace(/<indPres>\d<\/indPres>/, "<indPres>1</indPres>")
    .replace(/<tpImp>\d<\/tpImp>/, "<tpImp>6</tpImp>")
    .replace("<tpEmis>1</tpEmis>", "<tpEmis>9</tpEmis>")
    .replace(/<cDV>\d<\/cDV>/, `<cDV>${accessKey[43]}</cDV>`)
    .replace("</ide>", "<dhCont>2026-10-02T10:00:00-03:00</dhCont><xJust>Teste local de contingencia sem transmissao</xJust></ide>");
  const signedXml = signNfeXml(xml, key);
  const result = await supplementSimplifiedNfe({ signedXml, endpoints, signingKey: key });
  const parts = result.payload.split("|");
  assert.equal(parts.length, 8);
  assert.equal(parts[0], accessKey);
  assert.equal(parts[1], "3");
  assert.equal(parts[5], "1");
  assert.equal(verify("RSA-SHA1", Buffer.from(parts.slice(0, 7).join("|")), new X509Certificate(Buffer.from(key.certificateBase64, "base64")).publicKey, Buffer.from(parts[7], "base64")), true);
  await assertFiscalXml(result.xml, "nfe");
  await assert.rejects(supplementSimplifiedNfe({ signedXml, endpoints }));
});
