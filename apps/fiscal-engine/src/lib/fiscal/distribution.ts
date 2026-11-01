import { gunzipSync } from "node:zlib";
import { DOMParser } from "@xmldom/xmldom";
import { ACCESS_KEY_PATTERN } from "@/lib/fiscal/nfe";
import { SefazError } from "@/lib/fiscal/sefaz";

const NFE_NS = "http://www.portalfiscal.inf.br/nfe";
const WSDL = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe";
export const DISTRIBUTION_ACTION = `${WSDL}/nfeDistDFeInteresse`;
export const DISTRIBUTION_URL = "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";
export const DISTRIBUTION_HOMOLOGATION_URL = "https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";
export const distributionUrl = (environment: "homologacao" | "producao") => environment === "producao" ? DISTRIBUTION_URL : DISTRIBUTION_HOMOLOGATION_URL;
const MAX_DOCUMENT_BYTES = 2_097_152;
const MAX_BATCH_DOCUMENTS = 50;

export type DistributedDocument = { nsu: string; schema: string; kind: "summary" | "event" | "full"; xml: string };
export type DistributionResult = { code: string; reason: string; lastNsu: string; maxNsu: string; documents: DistributedDocument[] };
export type NfeSummary = { accessKey: string; issuerDocument: string; issuerName: string; issuedAt: Date; totalInvoice: number; situation: string };
export type DistributedNfeEvent = { accessKey: string; eventType: string; sequence: number; statusCode: string; protocol: string | null; registeredAt: Date | null };

const pick = (xml: string, name: string) => new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`).exec(xml)?.[1]?.trim() ?? "";
const xmlText = (value: string) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, "&");
const paddedNsu = (value: string) => {
  if (!/^\d{1,15}$/.test(value)) throw new Error("NSU inválido.");
  return value.padStart(15, "0");
};

export function parseNfeSummary(xml: string): NfeSummary {
  if (typeof xml !== "string" || Buffer.byteLength(xml, "utf8") > MAX_DOCUMENT_BYTES || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new SefazError("Resumo de NF-e inválido.");
  const errors: string[] = [];
  const document = new DOMParser({ onError: (level, message) => { if (level !== "warning") errors.push(message); } }).parseFromString(xml, "application/xml");
  const root = document.documentElement;
  const value = (name: string) => root?.getElementsByTagNameNS("*", name).item(0)?.textContent?.trim() ?? "";
  const accessKey = value("chNFe");
  const issuerDocument = value("CNPJ").toUpperCase();
  const issuerName = value("xNome");
  const issuedAt = new Date(value("dhEmi"));
  const totalInvoice = Number(value("vNF"));
  const situation = value("cSitNFe");
  if (errors.length || root?.localName !== "resNFe" || !ACCESS_KEY_PATTERN.test(accessKey) || !/^[0-9A-Z]{14}$/.test(issuerDocument) || !issuerName || Number.isNaN(issuedAt.valueOf()) || !Number.isFinite(totalInvoice) || totalInvoice < 0 || !/^\d+$/.test(situation)) throw new SefazError("Resumo de NF-e inválido.");
  return { accessKey, issuerDocument, issuerName, issuedAt, totalInvoice, situation };
}

export function parseDistributedNfeEvent(xml: string): DistributedNfeEvent {
  if (typeof xml !== "string" || Buffer.byteLength(xml, "utf8") > MAX_DOCUMENT_BYTES || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new SefazError("Evento de NF-e inválido.");
  const errors: string[] = [];
  const document = new DOMParser({ onError: (level, message) => { if (level !== "warning") errors.push(message); } }).parseFromString(xml, "application/xml");
  const root = document.documentElement;
  const receipts = root?.getElementsByTagNameNS("*", "retEvento");
  const info = receipts?.item(0)?.getElementsByTagNameNS("*", "infEvento").item(0);
  const value = (name: string) => info?.getElementsByTagNameNS("*", name).item(0)?.textContent?.trim() ?? "";
  const accessKey = value("chNFe");
  const eventType = value("tpEvento");
  const sequence = Number(value("nSeqEvento"));
  const statusCode = value("cStat");
  const protocol = value("nProt") || null;
  const registeredText = value("dhRegEvento");
  const registeredAt = registeredText ? new Date(registeredText) : null;
  if (errors.length || root?.localName !== "procEventoNFe" || !ACCESS_KEY_PATTERN.test(accessKey) || !/^\d{6}$/.test(eventType) || !Number.isSafeInteger(sequence) || sequence < 1 || !/^\d{3}$/.test(statusCode) || (registeredAt && Number.isNaN(registeredAt.valueOf()))) throw new SefazError("Evento de NF-e inválido.");
  return { accessKey, eventType, sequence, statusCode, protocol, registeredAt };
}

/** SOAP 1.2 request for the next sequential DF-e batch. */
export function distributionEnvelope(cnpj: string, lastNsu: string, environment: "homologacao" | "producao"): string {
  if (!/^[0-9A-Z]{14}$/.test(cnpj)) throw new Error("CNPJ inválido para distribuição DF-e.");
  return `<?xml version="1.0" encoding="UTF-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="${WSDL}"><distDFeInt xmlns="${NFE_NS}" versao="1.01"><tpAmb>${environment === "producao" ? "1" : "2"}</tpAmb><cUFAutor>91</cUFAutor><CNPJ>${cnpj}</CNPJ><distNSU><ultNSU>${paddedNsu(lastNsu)}</ultNSU></distNSU></distDFeInt></nfeDadosMsg></soap12:Body></soap12:Envelope>`;
}

function unpack(value: string): string {
  const compact = value.replace(/\s+/g, "");
  if (!compact || compact.length > MAX_DOCUMENT_BYTES * 2 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) throw new SefazError("Documento compactado inválido na resposta da SEFAZ (base64). ");
  try {
    const result = gunzipSync(Buffer.from(compact, "base64"), { maxOutputLength: MAX_DOCUMENT_BYTES }).toString("utf8");
    if (!result.trimStart().startsWith("<") || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(result)) throw new Error("XML recusado");
    return result;
  } catch {
    throw new SefazError("Documento compactado inválido na resposta da SEFAZ.");
  }
}

/** Reads and bounds a distribution response. Documents remain exactly as they were decompressed. */
export function parseDistributionResponse(response: string): DistributionResult {
  const body = /<(?:\w+:)?retDistDFeInt\b[\s\S]*?<\/(?:\w+:)?retDistDFeInt>/.exec(response)?.[0];
  if (!body) {
    const fault = pick(response, "Text") || pick(response, "faultstring");
    throw new SefazError(fault ? `A SEFAZ recusou a distribuição: ${xmlText(fault)}` : "A resposta da distribuição DF-e não é a esperada.");
  }
  const code = pick(body, "cStat");
  const reason = xmlText(pick(body, "xMotivo"));
  const lastNsu = paddedNsu(pick(body, "ultNSU") || "0");
  const maxNsu = paddedNsu(pick(body, "maxNSU") || lastNsu);
  const matches = [...body.matchAll(/<(?:(?:\w+):)?docZip\b([^>]*)>([\s\S]*?)<\/(?:(?:\w+):)?docZip>/g)];
  if (matches.length > MAX_BATCH_DOCUMENTS) throw new SefazError("A resposta da SEFAZ excede o limite de documentos por lote.");
  const documents = matches.map(([, attributes, packed]) => {
    const nsu = /\bNSU="(\d{15})"/.exec(attributes)?.[1] ?? "";
    const schema = /\bschema="([A-Za-z0-9_.-]{1,100})"/.exec(attributes)?.[1] ?? "";
    if (!nsu || !schema) throw new SefazError("Documento da distribuição sem NSU ou schema válido.");
    const kind = schema.startsWith("procNFe") ? "full" : schema.startsWith("procEventoNFe") ? "event" : "summary";
    return { nsu, schema, kind, xml: unpack(packed) } satisfies DistributedDocument;
  });
  if (code === "137" && documents.length) throw new SefazError("A SEFAZ informou ausência de documentos, mas devolveu conteúdo.");
  return { code, reason, lastNsu, maxNsu, documents };
}
