import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SignedXml } from "xml-crypto";
import { validateXML } from "xmllint-wasm";
import { eventEnvelope, eventText, eventUrl, eventXml, parseEvent, processedEventXml } from "@/lib/fiscal/events";
import type { NfeEvent } from "@/lib/fiscal/events";
import { NfeError } from "@/lib/fiscal/nfe";
import { SefazError } from "@/lib/fiscal/sefaz";
import { signEventXml, signingKeyOf } from "@/lib/fiscal/sign";
import { testPfx } from "./fiscal-helpers.ts";

const KEY = "35261012345678000195550010000001231482917360";
const key = signingKeyOf(testPfx(), "senha-de-teste");
const fixture = (name: string) => readFileSync(new URL(`./fixtures/nfe-xsd/${name}`, import.meta.url), "utf8");
const CANCEL: NfeEvent = { kind: "cancelamento", environment: "homologacao", accessKey: KEY, cnpj: "12345678000195", at: "2026-10-08T11:00:00-03:00", sequence: 1, protocol: "135260000012345", text: "Pedido cancelado pelo cliente & devolvido <sem uso>" };
const LETTER: NfeEvent = { kind: "correcao", environment: "producao", accessKey: KEY, cnpj: "12345678000195", at: "2026-10-08T11:00:00-03:00", sequence: 2, text: "Onde se lê Rua A, 10, leia-se Rua B, 20." };

async function schemaErrors(envelope: string, schema: string, layout: string): Promise<string[]> {
  const body = /<envEvento[\s\S]*<\/envEvento>/.exec(envelope)![0];
  const result = await validateXML({
    xml: [{ fileName: "evento.xml", contents: body }],
    schema: [{ fileName: schema, contents: fixture(schema) }],
    preload: [layout, "tiposBasico_v1.03.xsd", "xmldsig-core-schema_v1.01.xsd"].map((fileName) => ({ fileName, contents: fixture(fileName) })),
  });
  return result.errors.map((error) => error.message);
}

function verifies(signed: string): boolean {
  const signature = /<Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">[\s\S]*<\/Signature>/.exec(signed)?.[0];
  if (!signature) return false;
  const checker = new SignedXml({ publicCert: `-----BEGIN CERTIFICATE-----\n${key.certificateBase64}\n-----END CERTIFICATE-----` });
  checker.loadSignature(signature);
  try {
    return checker.checkSignature(signed);
  } catch {
    return false;
  }
}

test("cancelamento e carta de correção: o evento assinado passa no esquema oficial e confere em implementação independente", async () => {
  const cancel = signEventXml(eventXml(CANCEL).xml, key);
  assert.deepEqual(await schemaErrors(eventEnvelope(cancel, "1"), "envEventoCancNFe_v1.00.xsd", "leiauteEventoCancNFe_v1.00.xsd"), []);
  assert.equal(verifies(cancel), true);
  assert.equal(eventXml(CANCEL).id, `ID110111${KEY}01`);

  const letter = signEventXml(eventXml(LETTER).xml, key);
  assert.deepEqual(await schemaErrors(eventEnvelope(letter, "2"), "envCCe_v1.00.xsd", "leiauteCCe_v1.00.xsd"), []);
  assert.equal(verifies(letter), true);
  assert.equal(eventXml(LETTER).id, `ID110110${KEY}02`);
  assert.equal(verifies(cancel.replace("devolvido", "devolvida")), false);
});

test("evento: texto curto ou longo demais é recusado com mensagem para a tela; cancelamento exige o protocolo; só São Paulo tem endereço", () => {
  assert.throws(() => eventXml({ ...CANCEL, text: "curto" }), NfeError);
  assert.throws(() => eventXml({ ...CANCEL, text: "x".repeat(256) }), NfeError);
  assert.throws(() => eventXml({ ...LETTER, text: "muito   curto" }), NfeError);
  assert.throws(() => eventXml({ ...LETTER, sequence: 21 }), NfeError);
  assert.throws(() => eventXml({ ...CANCEL, protocol: undefined }), /protocolo/);
  assert.throws(() => eventEnvelope(eventXml(CANCEL).xml, "1"), /assinado/);
  assert.match(eventUrl("SP", "homologacao"), /homologacao\.nfe\.fazenda\.sp\.gov\.br\/ws\/nferecepcaoevento4\.asmx$/);
  assert.throws(() => eventUrl("RJ", "producao"), SefazError);
});

test("evento: a fila recebe o mesmo texto normalizado que será assinado", () => {
  assert.equal(eventText("correcao", "  Onde se lê Rua A,\nleia-se Rua B.  "), "Onde se lê Rua A, leia-se Rua B.");
  assert.throws(() => eventText("cancelamento", "curto"), /pelo menos 15 letras/);
  assert.throws(() => eventText("cancelamento", "x".repeat(256)), /passa de 255 letras/);
});

test("evento: leitura da resposta — registrado, recusado com o motivo, lote recusado e resposta sobre outra nota", () => {
  const answer = (inner: string) => `<soap:Envelope xmlns:soap="x"><soap:Body><retEnvEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe"><idLote>1</idLote><tpAmb>2</tpAmb><verAplic>SP</verAplic><cOrgao>35</cOrgao>${inner}</retEnvEvento></soap:Body></soap:Envelope>`;
  const event = (code: string, reason: string, chave = KEY) => `<cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo><retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><verAplic>SP</verAplic><cOrgao>35</cOrgao><cStat>${code}</cStat><xMotivo>${reason}</xMotivo><chNFe>${chave}</chNFe><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento>${code === "135" ? "<dhRegEvento>2026-10-08T11:00:05-03:00</dhRegEvento><nProt>135260000099999</nProt>" : ""}</infEvento></retEvento>`;
  assert.deepEqual(parseEvent(answer(event("135", "Evento registrado e vinculado a NF-e")), KEY), { registered: true, code: "135", reason: "Evento registrado e vinculado a NF-e", protocol: "135260000099999" });
  assert.deepEqual(parseEvent(answer(event("501", "Rejeição: Prazo de cancelamento superior ao previsto na legislação")), KEY), { registered: false, code: "501", reason: "Rejeição: Prazo de cancelamento superior ao previsto na legislação" });
  assert.deepEqual(parseEvent(answer("<cStat>215</cStat><xMotivo>Rejeição: Falha no schema XML</xMotivo>"), KEY), { registered: false, code: "215", reason: "Rejeição: Falha no schema XML" });
  assert.throws(() => parseEvent(answer(event("135", "ok", "9".repeat(44))), KEY), /outra nota/);
  assert.throws(() => parseEvent("<html/>", KEY), SefazError);
});

test("evento distribuído: conserva retorno real, valida no XSD e recusa recibo de outra sequência/ambiente/tipo", async () => {
  const signed = signEventXml(eventXml(LETTER).xml, key);
  const receipt = `<retEvento versao="1.00"><infEvento><tpAmb>1</tpAmb><verAplic>SP_NFE</verAplic><cOrgao>35</cOrgao><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>${KEY}</chNFe><tpEvento>110110</tpEvento><nSeqEvento>2</nSeqEvento><dhRegEvento>2026-10-08T11:00:05-03:00</dhRegEvento><nProt>135260000099999</nProt></infEvento></retEvento>`;
  const answer = `<retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><cStat>128</cStat>${receipt}</retEnvEvento>`;
  const processed = processedEventXml(signed, answer);
  assert.ok(processed.includes(signed) && processed.includes(receipt));
  const folder = "PL_010d_v1.03/Evento/";
  const schema = "procEventoNFe_v1.00.xsd";
  const validation = await validateXML({
    xml: [{ fileName: "evento.xml", contents: processed }],
    schema: [{ fileName: schema, contents: fixture(folder + schema) }],
    preload: ["leiauteEvento_v1.00.xsd", "tiposBasico_v1.03.xsd", "xmldsig-core-schema_v1.01.xsd"].map((fileName) => ({ fileName, contents: fixture(folder + fileName) })),
  });
  assert.deepEqual(validation.errors.map((error) => error.message), []);
  assert.equal(verifies(processed), true);
  for (const [before, after] of [["<tpAmb>1", "<tpAmb>2"], ["<tpEvento>110110", "<tpEvento>110111"], ["<nSeqEvento>2", "<nSeqEvento>1"], [`<chNFe>${KEY}`, `<chNFe>${"9".repeat(44)}`]]) {
    assert.throws(() => processedEventXml(signed, answer.replace(before, after)), SefazError);
  }
  const unlinked = answer.replace("<cStat>135", "<cStat>136");
  assert.equal(parseEvent(unlinked, KEY).registered, false);
  assert.throws(() => processedEventXml(signed, unlinked), /não foi vinculado/);
  assert.throws(() => processedEventXml(signed, answer.replace("<cStat>135", "<cStat>155")), /não confirmou/);
});
