import { createHash } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import type { Element } from "@xmldom/xmldom";
import { isNumericCnpj, isNumericCpf } from "./brazilian-document.ts";
import { assertNationalNfseLayout, NationalNfseXmlError } from "./nfse-layout.ts";
import type { NationalNfseLayoutVerification } from "./nfse-layout.ts";

const NS = "http://www.sped.fazenda.gov.br/nfse";
type Party = { kind: "CNPJ" | "CPF" | "NIF" | "no_nif"; value: string; name: string | null };
export type InspectedNationalNfse = {
  source: "nfse_nacional"; schemaVersion: string; accessKey: string; environment: "production" | "homologation"
  number: string; municipalityCode: string; issuedAt: string; processedAt: string; processingCode: string
  issuer: Party; provider: Party; recipient: Party; serviceCode: string; description: string
  serviceCents: string; netCents: string; xml: string; xmlSha256: string
  verification: NationalNfseLayoutVerification & { signature: "not_verified"; currentStatus: "not_queried" }
};
const invalid = (message = "XML de NFS-e nacional inválido.") => new NationalNfseXmlError("invalid", message);

function child(parent: Element, name: string, required = true): Element | null {
  const matches: Element[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) if (node.nodeType === 1) {
    const element = node as Element;
    if (element.localName === name && element.namespaceURI === NS) matches.push(element);
  }
  if (matches.length > 1 || (required && matches.length !== 1)) throw invalid();
  return matches[0] ?? null;
}
function field(parent: Element, name: string): string {
  const element = child(parent, name)!;
  if (element.getElementsByTagName("*").length || !element.textContent) throw invalid();
  return element.textContent;
}
function party(element: Element): Party {
  const identities = ["CNPJ", "CPF", "NIF", "cNaoNIF"].flatMap(name => child(element, name, false) ? [name] : []);
  if (identities.length !== 1) throw invalid("Identificação do participante da NFS-e inválida.");
  const kind = identities[0], value = field(element, kind);
  if ((kind === "CNPJ" && !isNumericCnpj(value)) || (kind === "CPF" && !isNumericCpf(value))) throw invalid("Identificação CNPJ/CPF do participante da NFS-e inválida.");
  const name = child(element, "xNome", false);
  return { kind: kind === "cNaoNIF" ? "no_nif" : kind as Party["kind"], value, name: name ? field(element, "xNome") : null };
}
function cents(value: string): string {
  const match = /^(0|[1-9][0-9]{0,14})(?:\.([0-9]{2}))?$/.exec(value);
  if (!match) throw invalid("Valor monetário da NFS-e fora do recorte suportado.");
  return (BigInt(match[1]) * 100n + BigInt(match[2] ?? "0")).toString();
}

/** Read-only, deterministic inspection of a source file; no certificate, cursor, transport or writes. */
export async function inspectReceivedNationalNfse(input: { xml: string; recipientTaxId: string }): Promise<InspectedNationalNfse> {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["xml", "recipientTaxId"].includes(key))) throw invalid("Campo desconhecido na inspeção de NFS-e.");
  if (!isNumericCnpj(input.recipientTaxId)) throw invalid("CNPJ do tomador da NFS-e inválido.");
  const xml = input.xml;
  if (typeof xml !== "string" || !xml || Buffer.byteLength(xml, "utf8") > 1_048_576 || /\0|<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw invalid("XML de NFS-e inválido ou acima do limite de 1 MiB.");
  const sourceBytes = Buffer.from(xml, "utf8");
  if (sourceBytes.toString("utf8") !== xml) throw invalid("XML de NFS-e contém caractere sem representação UTF-8 válida.");
  const declaration = /^\uFEFF?<\?xml\b([\s\S]*?)\?>/.exec(xml)?.[1];
  const encoding = declaration && /\bencoding\s*=\s*(["'])(.*?)\1/i.exec(declaration)?.[2];
  const xmlVersion = declaration && /\bversion\s*=\s*(["'])(.*?)\1/i.exec(declaration)?.[2];
  if (encoding && !/^UTF-8$/i.test(encoding) || xmlVersion && xmlVersion !== "1.0") throw invalid("XML de NFS-e deve usar XML 1.0 e UTF-8.");
  let root: Element;
  try {
    const document = new DOMParser({ onError: () => { throw invalid(); } }).parseFromString(xml.replace(/^\uFEFF/, ""), "application/xml");
    if (!document.documentElement) throw invalid();
    root = document.documentElement;
  } catch { throw invalid(); }
  if (root.localName !== "NFSe" || root.namespaceURI !== NS) throw invalid("Raiz ou namespace de NFS-e nacional inválido.");
  const version = root.getAttribute("versao") ?? "";
  const validation = await assertNationalNfseLayout(xml, version);
  const info = child(root, "infNFSe")!, dps = child(info, "DPS")!;
  if (dps.getAttribute("versao") !== version) throw invalid("Versão da DPS difere da NFS-e.");
  const detail = child(dps, "infDPS")!, recipientElement = child(detail, "toma", false);
  if (!/^[0-9]{1,5}$/.test(field(detail, "serie"))) throw invalid("Série da DPS fora do recorte numérico de 1 a 5 posições.");
  if (!recipientElement) throw invalid("NFS-e sem tomador identificável da empresa.");
  const recipient = party(recipientElement);
  if (recipient.kind !== "CNPJ" || recipient.value !== input.recipientTaxId) throw invalid("Tomador da NFS-e não corresponde ao CNPJ da empresa.");
  const id = info.getAttribute("Id") ?? "";
  if (!/^NFS[0-9]{50}$/.test(id)) throw invalid("Chave nacional da NFS-e inválida.");
  const environment = field(detail, "tpAmb");
  if (!["1", "2"].includes(environment)) throw invalid("Ambiente da NFS-e inválido.");
  const service = child(child(detail, "serv")!, "cServ")!;
  return {
    source: "nfse_nacional", schemaVersion: version, accessKey: id.slice(3), environment: environment === "1" ? "production" : "homologation",
    number: field(info, "nNFSe"), municipalityCode: field(detail, "cLocEmi"), issuedAt: field(detail, "dhEmi"), processedAt: field(info, "dhProc"), processingCode: field(info, "cStat"),
    issuer: party(child(info, "emit")!), provider: party(child(detail, "prest")!), recipient,
    serviceCode: field(service, "cTribNac"), description: field(service, "xDescServ"), serviceCents: cents(field(child(child(detail, "valores")!, "vServPrest")!, "vServ")), netCents: cents(field(child(info, "valores")!, "vLiq")),
    xml, xmlSha256: createHash("sha256").update(sourceBytes).digest("hex"), verification: { ...validation, signature: "not_verified", currentStatus: "not_queried" },
  };
}
