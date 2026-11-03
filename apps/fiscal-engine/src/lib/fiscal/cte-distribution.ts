import { gunzipSync } from "node:zlib";
import { DOMParser } from "@xmldom/xmldom";
import type { Element } from "@xmldom/xmldom";
import { UF_CODES } from "@/lib/fiscal/nfe";
import { isNumericCnpj } from "./brazilian-document.ts";

const CTE_NAMESPACE = "http://www.portalfiscal.inf.br/cte";
const SOAP_NAMESPACES = new Set(["http://www.w3.org/2003/05/soap-envelope", "http://schemas.xmlsoap.org/soap/envelope/"]);
const MAX_RESPONSE_BYTES = 8_388_608;
const MAX_DOCUMENT_BYTES = 2_097_152;
const MAX_INFLATED_BATCH_BYTES = 8_388_608;
const MAX_BATCH_DOCUMENTS = 50;

export type CteDistributionEnvironment = "homologation" | "production";
export type CteDistributionContext = { environment: CteDistributionEnvironment; lastNsu: string };
export type CteDistributionRequest = CteDistributionContext & { authorState: string; companyTaxId: string };
export type DistributedCteDocument = { nsu: string; schema: string; kind: "full" | "event" | "unrecognized"; xml: string };
export type CteDistributionResult = {
  code: string;
  reason: string;
  lastNsu: string;
  maxNsu: string;
  /** Only a successful, fully parsed batch may be committed with its documents. */
  nextNsu: string | null;
  documents: DistributedCteDocument[];
};

export class CteDistributionError extends Error {
  constructor(message: string) { super(message); this.name = "CteDistributionError"; }
}

function environmentCode(environment: CteDistributionEnvironment): string {
  if (environment === "homologation") return "2";
  if (environment === "production") return "1";
  throw new CteDistributionError("Ambiente inválido para distribuição CT-e.");
}

function paddedNsu(value: string): string {
  if (typeof value !== "string" || !/^\d{1,15}$/.test(value)) throw new CteDistributionError("NSU inválido para distribuição CT-e.");
  return value.padStart(15, "0");
}

/** Builds the CT-e distribution data, not an NF-e request or a transport call. */
export function buildCteDistributionRequest(input: CteDistributionRequest): string {
  const environment = environmentCode(input.environment);
  if (typeof input.authorState !== "string" || !Object.hasOwn(UF_CODES, input.authorState)) throw new CteDistributionError("UF do ator CT-e inválida.");
  // The official PL_CTeDistDFe_100 package accepts numeric CNPJ only.
  if (!isNumericCnpj(input.companyTaxId)) throw new CteDistributionError("CNPJ inválido para distribuição CT-e.");
  const nsu = paddedNsu(input.lastNsu);
  return `<?xml version="1.0" encoding="UTF-8"?><distDFeInt xmlns="${CTE_NAMESPACE}" versao="1.00"><tpAmb>${environment}</tpAmb><cUFAutor>${UF_CODES[input.authorState]}</cUFAutor><CNPJ>${input.companyTaxId}</CNPJ><distNSU><ultNSU>${nsu}</ultNSU></distNSU></distDFeInt>`;
}

function xmlCharacter(code: number): boolean {
  return code === 9 || code === 10 || code === 13 || code >= 0x20 && code <= 0xD7FF || code >= 0xE000 && code <= 0xFFFD || code >= 0x10000 && code <= 0x10FFFF;
}

function assertXmlCharacters(xml: string): void {
  // XML 1.0 §2.2 / §4.1: xmldom does not reject every forbidden character reference.
  for (const character of xml) {
    if (!xmlCharacter(character.codePointAt(0)!)) throw new CteDistributionError("Caractere proibido no XML CT-e.");
  }
  // Scan once: references are literal inside comments, CDATA and processing
  // instructions. Failed delimiter searches must not rescan a hostile suffix.
  for (let index = 0; index < xml.length; index++) {
    const literal = xml[index] === "<" ? [["<!--", "-->"], ["<![CDATA[", "]]>"], ["<?", "?>"]].find(([start]) => xml.startsWith(start, index)) : undefined;
    if (literal) {
      const end = xml.indexOf(literal[1], index + literal[0].length);
      if (end < 0) throw new CteDistributionError("XML CT-e malformado.");
      index = end + literal[1].length - 1;
      continue;
    }
    if (xml[index] !== "&" || xml[index + 1] !== "#") continue;
    const end = xml.indexOf(";", index + 2);
    if (end < 0) throw new CteDistributionError("Referência de caractere incompleta no XML CT-e.");
    const token = xml.slice(index, end + 1);
    const digits = /^&#(?:x([0-9A-Fa-f]+)|([0-9]+));$/.exec(token);
    const code = digits ? Number.parseInt(digits[1] ?? digits[2], digits[1] ? 16 : 10) : NaN;
    if (!xmlCharacter(code)) throw new CteDistributionError("Referência de caractere proibida no XML CT-e.");
    index = end;
  }
}

function parseXml(xml: string, limit: number): Element {
  if (typeof xml !== "string" || Buffer.byteLength(xml, "utf8") > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f]|<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) {
    throw new CteDistributionError("XML CT-e recusado por tamanho, caracteres ou declaração de entidades.");
  }
  assertXmlCharacters(xml);
  try {
    const parsed = new DOMParser({ onError: () => { throw new Error("XML inválido"); } }).parseFromString(xml, "application/xml");
    if (!parsed.documentElement) throw new Error("Sem raiz");
    return parsed.documentElement;
  } catch {
    throw new CteDistributionError("XML CT-e malformado.");
  }
}

function children(element: Element): Element[] {
  const elements: Element[] = [];
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) elements.push(child as Element);
    else if ((child.nodeType === 3 || child.nodeType === 4) && child.textContent?.trim()) throw new CteDistributionError("Estrutura do retorno CT-e inválida.");
  }
  return elements;
}

function scalar(element: Element): string {
  if (element.namespaceURI !== CTE_NAMESPACE || element.getElementsByTagName("*").length) throw new CteDistributionError("Campo ou namespace do retorno CT-e inválido.");
  return element.textContent?.trim() ?? "";
}

function distributionRoot(root: Element): Element {
  if (root.localName === "retDistDFeInt" && root.namespaceURI === CTE_NAMESPACE) return root;
  if (root.localName !== "Envelope" || !SOAP_NAMESPACES.has(root.namespaceURI ?? "")) throw new CteDistributionError("Retorno da distribuição CT-e inesperado.");
  const bodies = children(root).filter((element) => element.localName === "Body" && element.namespaceURI === root.namespaceURI);
  const returns = root.getElementsByTagNameNS(CTE_NAMESPACE, "retDistDFeInt");
  if (bodies.length !== 1 || returns.length !== 1 || bodies[0].getElementsByTagNameNS(CTE_NAMESPACE, "retDistDFeInt").length !== 1) throw new CteDistributionError("Retorno SOAP CT-e ausente ou ambíguo.");
  return returns.item(0)!;
}

/** Extracts one namespace-checked payload for offline XSD validation of SOAP replies. */
export function cteDistributionResponseXml(response: string): string {
  return distributionRoot(parseXml(response, MAX_RESPONSE_BYTES)).toString();
}

function unpack(packed: string): { xml: string; bytes: number; root: Element } {
  const compact = packed.replace(/\s/g, "");
  if (!compact || compact.length > MAX_DOCUMENT_BYTES * 2 || compact.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) {
    throw new CteDistributionError("Base64 inválido no documento CT-e compactado.");
  }
  let bytes: Buffer;
  let xml: string;
  try {
    const encoded = Buffer.from(compact, "base64");
    if (encoded.toString("base64") !== compact) throw new Error("Base64 não canônico");
    bytes = gunzipSync(encoded, { maxOutputLength: MAX_DOCUMENT_BYTES });
    xml = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new CteDistributionError("Documento CT-e compactado inválido ou acima do limite de tamanho/UTF-8.");
  }
  return { xml, bytes: bytes.length, root: parseXml(xml, MAX_DOCUMENT_BYTES) };
}

function documentKind(schema: string, root: Element): DistributedCteDocument["kind"] {
  const full = /^procCTe_v\d+\.\d+\.xsd$/.test(schema);
  const event = /^procEventoCTe_v\d+\.\d+\.xsd$/.test(schema);
  if (!full && !event) return "unrecognized";
  if (root.namespaceURI !== CTE_NAMESPACE || root.localName !== (full ? "cteProc" : "procEventoCTe")) throw new CteDistributionError("Documento CT-e incompatível com o schema declarado.");
  return full ? "full" : "event";
}

/** Protocol validation only; document signature/schema and actor checks belong to ingestion. */
export function parseCteDistributionResponse(response: string, context: CteDistributionContext): CteDistributionResult {
  const expectedEnvironment = environmentCode(context.environment);
  const requestedNsu = paddedNsu(context.lastNsu);
  const root = distributionRoot(parseXml(response, MAX_RESPONSE_BYTES));
  if (root.getAttribute("versao") !== "1.00") throw new CteDistributionError("Versão do retorno CT-e não suportada.");
  const fields = children(root);
  const expected = ["tpAmb", "verAplic", "cStat", "xMotivo", "dhResp", "ultNSU", "maxNSU"];
  if (fields.length < expected.length || fields.length > expected.length + 1 || expected.some((name, index) => fields[index]?.localName !== name) || fields.some((element) => element.namespaceURI !== CTE_NAMESPACE)) {
    throw new CteDistributionError("Estrutura do retorno CT-e inválida ou ambígua.");
  }
  const [environment, application, code, reason, respondedAt, lastNsu, maxNsu] = fields.slice(0, 7).map(scalar);
  if (environment !== expectedEnvironment) throw new CteDistributionError("Retorno CT-e pertence a outro ambiente.");
  if (!application || !/^\d{3}$/.test(code) || !reason || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})?$/.test(respondedAt) || !Number.isFinite(Date.parse(respondedAt))) throw new CteDistributionError("Campos do retorno CT-e inválidos.");
  if (!/^\d{15}$/.test(lastNsu) || !/^\d{15}$/.test(maxNsu)) throw new CteDistributionError("NSU do retorno CT-e inválido.");
  const batch = fields[7];
  if (batch && batch.localName !== "loteDistDFeInt") throw new CteDistributionError("Lote do retorno CT-e inválido.");
  const entries = batch ? children(batch) : [];
  if (entries.length > MAX_BATCH_DOCUMENTS || (batch && entries.length === 0)) throw new CteDistributionError("Lote CT-e deve conter de 1 a 50 documentos.");
  const successful = code === "137" || code === "138";
  if (code === "138" ? entries.length === 0 : entries.length !== 0) throw new CteDistributionError("Documentos incompatíveis com o status do retorno CT-e.");
  if (successful && (lastNsu < requestedNsu || lastNsu > maxNsu || (code === "138" && lastNsu === requestedNsu))) throw new CteDistributionError("NSU do retorno CT-e regressivo ou incompatível com a consulta.");
  let previousNsu = requestedNsu;
  let inflatedBytes = 0;
  const documents = entries.map((entry): DistributedCteDocument => {
    if (entry.namespaceURI !== CTE_NAMESPACE || entry.localName !== "docZip") throw new CteDistributionError("Documento inesperado no lote CT-e.");
    const nsu = entry.getAttribute("NSU") ?? "";
    const schema = entry.getAttribute("schema") ?? "";
    if (!/^\d{15}$/.test(nsu) || nsu <= previousNsu || nsu > lastNsu) throw new CteDistributionError("NSU duplicado, desordenado ou fora do intervalo CT-e.");
    if (!/^[A-Za-z0-9_.-]{1,100}\.xsd$/.test(schema)) throw new CteDistributionError("Schema do documento CT-e inválido.");
    const unpacked = unpack(scalar(entry));
    inflatedBytes += unpacked.bytes;
    if (inflatedBytes > MAX_INFLATED_BATCH_BYTES) throw new CteDistributionError("Lote CT-e ultrapassa o limite de tamanho descompactado.");
    previousNsu = nsu;
    return { nsu, schema, kind: documentKind(schema, unpacked.root), xml: unpacked.xml };
  });
  return { code, reason, lastNsu, maxNsu, nextNsu: successful ? lastNsu : null, documents };
}
