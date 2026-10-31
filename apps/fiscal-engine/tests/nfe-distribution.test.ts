import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { test } from "node:test";
import { distributionEnvelope, distributionUrl, parseDistributionResponse, parseNfeSummary } from "@/lib/fiscal/distribution";
import { recipientEventUrl } from "../src/engine.ts";
import { recipientManifestXml } from "@/lib/fiscal/recipient-manifest";

const KEY = "35261060677380000106550010000001231000001230";

test("distribuição pede o próximo lote pelo último NSU e lê resumos, eventos e XML completo", () => {
  const envelope = distributionEnvelope("60067738000106", "123", "producao");
  assert.match(envelope, /<CNPJ>60067738000106<\/CNPJ><distNSU><ultNSU>000000000000123<\/ultNSU><\/distNSU>/);
  const packed = (xml: string) => gzipSync(xml).toString("base64");
  const response = `<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><verAplic>1.0</verAplic><cStat>138</cStat><xMotivo>Documentos localizados</xMotivo><dhResp>2026-10-18T12:00:00-03:00</dhResp><ultNSU>000000000000125</ultNSU><maxNSU>000000000000200</maxNSU><loteDistDFeInt><docZip NSU="000000000000124" schema="resNFe_v1.01.xsd">${packed("<resNFe><chNFe>1</chNFe></resNFe>")}</docZip><docZip NSU="000000000000125" schema="procNFe_v4.00.xsd">${packed("<nfeProc><NFe/></nfeProc>")}</docZip></loteDistDFeInt></retDistDFeInt>`;
  const result = parseDistributionResponse(response);
  assert.deepEqual([result.code, result.lastNsu, result.maxNsu, result.documents.length], ["138", "000000000000125", "000000000000200", 2]);
  assert.deepEqual(result.documents.map(({ nsu, schema, kind }) => [nsu, schema, kind]), [["000000000000124", "resNFe_v1.01.xsd", "summary"], ["000000000000125", "procNFe_v4.00.xsd", "full"]]);
});

test("distribuição e manifestação usam o endpoint do ambiente fiscal", () => {
  assert.match(distributionUrl("producao"), /^https:\/\/www1\./);
  assert.match(distributionUrl("homologacao"), /^https:\/\/hom1\./);
  assert.match(recipientEventUrl("producao"), /^https:\/\/www\./);
  assert.match(recipientEventUrl("homologacao"), /^https:\/\/hom1\./);
});

test("distribuição respeita ausência de documentos e recusa conteúdo fora dos limites", () => {
  const empty = parseDistributionResponse(`<retDistDFeInt><cStat>137</cStat><xMotivo>Nenhum documento</xMotivo><ultNSU>000000000000001</ultNSU><maxNSU>000000000000001</maxNSU></retDistDFeInt>`);
  assert.deepEqual([empty.code, empty.documents.length], ["137", 0]);
  assert.throws(() => parseDistributionResponse(`<retDistDFeInt><cStat>138</cStat><xMotivo>ok</xMotivo><ultNSU>1</ultNSU><maxNSU>1</maxNSU><docZip NSU="000000000000002" schema="x">não-base64</docZip></retDistDFeInt>`), /compactado|base64/);
});

test("resumo da distribuição preserva identidade suficiente para manifestação explícita", () => {
  const summary = parseNfeSummary(`<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><chNFe>${KEY}</chNFe><CNPJ>60677380000106</CNPJ><xNome>Fornecedor Teste Ltda</xNome><IE>116810452119</IE><dhEmi>2026-10-18T12:00:00-03:00</dhEmi><tpNF>1</tpNF><vNF>105.00</vNF><digVal>abc=</digVal><dhRecbto>2026-10-18T12:05:00-03:00</dhRecbto><nProt>135260000000123</nProt><cSitNFe>1</cSitNFe></resNFe>`);
  assert.deepEqual(summary, { accessKey: KEY, issuerDocument: "60677380000106", issuerName: "Fornecedor Teste Ltda", issuedAt: new Date("2026-10-18T15:00:00.000Z"), totalInvoice: 105, situation: "1" });
  assert.throws(() => parseNfeSummary(`<resNFe><chNFe>${KEY}</chNFe></resNFe>`), /resumo/i);
});

test("manifestação do destinatário monta apenas os quatro eventos permitidos e exige justificativa", () => {
  const event = recipientManifestXml({ accessKey: KEY, cnpj: "60067738000106", environment: "producao", at: "2026-10-18T12:00:00-03:00", kind: "confirmacao" });
  assert.equal(event.id, `ID210200${KEY}01`);
  assert.match(event.xml, /<tpEvento>210200<\/tpEvento>.*<descEvento>Confirmacao da Operacao<\/descEvento>/);
  assert.throws(() => recipientManifestXml({ accessKey: KEY, cnpj: "60067738000106", environment: "producao", at: "2026-10-18T12:00:00-03:00", kind: "nao_realizada", reason: "curto" }), /15/);
});
