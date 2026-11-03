import { createHash, X509Certificate } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import type { Element } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";
import { ACCESS_KEY_PATTERN, accessKeyDigit, accessKeyUf, UF_CODES } from "./nfe.ts";
import { isNumericCnpj } from "./brazilian-document.ts";
import { assertReceivedCteLayout, CTE_INSPECTION_RELEASE, CTE_MODAL_PROFILES, CteInspectionError } from "./cte-received-layout.ts";
export { CteInspectionError } from "./cte-received-layout.ts";

const NS = "http://www.portalfiscal.inf.br/cte";
const DS = "http://www.w3.org/2000/09/xmldsig#";
const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
type Party = { kind: "CNPJ" | "CPF"; value: string; name: string | null };
export type CteCompanyRole = "carrier" | "sender" | "dispatcher" | "receiver" | "recipient" | "taker" | "authorized_xml";
export type InspectedReceivedCte = {
  source: "cte_distribution"; schemaVersion: "4.00"; profile: string;
  environment: "homologation"; companyTaxId: string; accessKey: string;
  number: string; series: string; issuedAt: string; modal: string; documentType: string;
  carrier: Party; sender: Party | null; dispatcher: Party | null; receiver: Party | null; recipient: Party | null;
  taker: Party; takerRole: "sender" | "dispatcher" | "receiver" | "recipient" | "other";
  companyRoles: CteCompanyRole[]; serviceCents: string; receivableCents: string; nfeReferences: string[]; cteReferences: string[];
  protocol: { code: string; number: string; receivedAt: string; digest: string };
  xml: string; xmlSha256: string;
  verification: { layout: "official_schema_valid"; signature: "consistent"; certificateTrust: "not_verified"; currentStatus: "not_queried"; protocolAuthenticity: "not_verified" };
};
const invalid = () => new CteInspectionError("invalid");

function children(parent: Element, name: string, namespace = NS): Element[] {
  const matches: Element[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) if (node.nodeType === 1) {
    const element = node as Element;
    if (element.localName === name && element.namespaceURI === namespace) matches.push(element);
  }
  return matches;
}
function child(parent: Element, name: string, required = true, namespace = NS): Element | null {
  const matches = children(parent, name, namespace);
  if (matches.length > 1 || required && matches.length !== 1) throw invalid();
  return matches[0] ?? null;
}
function field(parent: Element, name: string, namespace = NS): string {
  const element = child(parent, name, true, namespace)!;
  if (element.getElementsByTagName("*").length || !element.textContent) throw invalid();
  return element.textContent;
}
function party(element: Element): Party {
  const kind = ["CNPJ", "CPF"].filter(name => child(element, name, false));
  if (kind.length !== 1) throw invalid();
  return { kind: kind[0] as Party["kind"], value: field(element, kind[0]), name: child(element, "xNome", false) ? field(element, "xNome") : null };
}
function cents(value: string): string {
  const match = /^(0|[1-9][0-9]{0,12})(?:\.([0-9]{2}))?$/.exec(value);
  if (!match) throw invalid();
  return (BigInt(match[1]) * 100n + BigInt(match[2] ?? "0")).toString();
}
function validKey(value: string, model: string): boolean {
  return ACCESS_KEY_PATTERN.test(value) && !!accessKeyUf(value) && value.slice(20, 22) === model && accessKeyDigit(value.slice(0, 43)) === value[43];
}

/** Check the issuer's signed infCte. Protocol authentication/trust remain separate. */
function signatureDigest(root: Element, cte: Element, info: Element, xml: string): string {
  const signature = child(cte, "Signature", true, DS)!;
  if (cte.getElementsByTagNameNS(DS, "Signature").length !== 1) throw invalid();
  const signedInfo = child(signature, "SignedInfo", true, DS)!;
  if (child(signedInfo, "CanonicalizationMethod", true, DS)!.getAttribute("Algorithm") !== C14N || child(signedInfo, "SignatureMethod", true, DS)!.getAttribute("Algorithm") !== `${DS}rsa-sha1`) throw invalid();
  const reference = child(signedInfo, "Reference", true, DS)!;
  const id = info.getAttribute("Id");
  if (!id || reference.getAttribute("URI") !== `#${id}` || child(reference, "DigestMethod", true, DS)!.getAttribute("Algorithm") !== `${DS}sha1`) throw invalid();
  const algorithms = Array.from(child(reference, "Transforms", true, DS)!.getElementsByTagNameNS(DS, "Transform")).map(node => node.getAttribute("Algorithm"));
  if (algorithms.length !== 2 || algorithms[0] !== `${DS}enveloped-signature` || algorithms[1] !== C14N) throw invalid();
  // A protocol may have its own distinct Id; it must never alias the signed infCte.
  for (const element of [root, ...Array.from(root.getElementsByTagName("*"))]) for (const attribute of Array.from(element.attributes)) {
    if (attribute.localName.toLowerCase() === "id" && attribute.value === id && (element !== info || attribute.name !== "Id")) throw invalid();
  }
  const encoded = field(child(child(signature, "KeyInfo", true, DS)!, "X509Data", true, DS)!, "X509Certificate", DS).replace(/\s/g, "");
  if (encoded.length > 16_384 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw invalid();
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) throw invalid();
  const certificate = new X509Certificate(bytes);
  if (certificate.publicKey.asymmetricKeyType !== "rsa" || (certificate.publicKey.asymmetricKeyDetails?.modulusLength ?? 0) > 8192) throw invalid();
  const checker = new SignedXml({ publicCert: certificate.toString(), getCertFromKeyInfo: () => null });
  checker.loadSignature(signature);
  if (!checker.checkSignature(xml) || checker.getReferences().length !== 1) throw invalid();
  const digest = field(reference, "DigestValue", DS);
  if (!/^[A-Za-z0-9+/]{27}=$/.test(digest) || Buffer.from(digest, "base64").toString("base64") !== digest) throw invalid();
  return digest;
}

/** Offline facts for a source already preserved by capture; no cursor, network or commercial write. */
export async function inspectReceivedCte(input: { xml: string; companyTaxId: string; environment: "homologation" }): Promise<InspectedReceivedCte> {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["xml", "companyTaxId", "environment"].includes(key)) || input.environment !== "homologation" || !isNumericCnpj(input.companyTaxId)) throw invalid();
    const companyTaxId = input.companyTaxId, xml = input.xml;
    if (typeof xml !== "string" || !xml || Buffer.byteLength(xml, "utf8") > 2_097_152 || /\0|<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw invalid();
    const bytes = Buffer.from(xml, "utf8");
    if (bytes.toString("utf8") !== xml) throw invalid();
    const declaration = /^\uFEFF?<\?xml\b([\s\S]*?)\?>/.exec(xml)?.[1];
    const encoding = declaration && /\bencoding\s*=\s*(["'])(.*?)\1/i.exec(declaration)?.[2];
    const version = declaration && /\bversion\s*=\s*(["'])(.*?)\1/i.exec(declaration)?.[2];
    if (encoding && !/^UTF-8$/i.test(encoding) || version && version !== "1.0") throw invalid();
    const document = new DOMParser({ onError: () => { throw invalid(); } }).parseFromString(xml.replace(/^\uFEFF/, ""), "application/xml");
    const root = document.documentElement;
    if (!root || root.localName !== "cteProc" || root.namespaceURI !== NS || root.getElementsByTagName("*").length > 100_000) throw invalid();
    if (root.getAttribute("versao") !== "4.00") throw new CteInspectionError("unsupported");
    const cte = child(root, "CTe")!, info = child(cte, "infCte")!, ide = child(info, "ide")!;
    if (info.getAttribute("versao") !== "4.00" || field(ide, "mod") !== "57") throw invalid();
    const modal = field(ide, "modal"), type = field(ide, "tpCTe"), normal = child(info, "infCTeNorm", false);
    const profile = Object.hasOwn(CTE_MODAL_PROFILES, modal) ? CTE_MODAL_PROFILES[modal] : null;
    if (!profile) throw new CteInspectionError("unsupported");
    // Complementary CT-e has no modal block; its structural validation uses only procCTe.
    if (!["0", "1", "3"].includes(type)) throw new CteInspectionError("unsupported");
    if ((type === "1") === !!normal) throw invalid();
    let modalXml: string | null = null;
    if (normal) {
      const modalInfo = child(normal, "infModal")!, specific = child(modalInfo, profile.root)!;
      if (modalInfo.getAttribute("versaoModal") !== "4.00") throw new CteInspectionError("unsupported");
      const detached = specific.cloneNode(true) as Element;
      detached.setAttribute("xmlns", NS);
      modalXml = detached.toString();
    }
    await assertReceivedCteLayout(xml, modal, modalXml);
    const carrier = party(child(info, "emit")!), issuedAt = field(ide, "dhEmi");
    const accessKey = (info.getAttribute("Id") ?? "").replace(/^CTe/, "");
    if (!validKey(accessKey, "57") || field(ide, "cUF") !== accessKey.slice(0, 2) || UF_CODES[field(child(child(info, "emit")!, "enderEmit")!, "UF")] !== accessKey.slice(0, 2) ||
      issuedAt.slice(2, 4) + issuedAt.slice(5, 7) !== accessKey.slice(2, 6) || carrier.value.padStart(14, "0") !== accessKey.slice(6, 20) ||
      field(ide, "serie").padStart(3, "0") !== accessKey.slice(22, 25) || field(ide, "nCT").padStart(9, "0") !== accessKey.slice(25, 34) ||
      field(ide, "tpEmis") !== accessKey[34] || field(ide, "cCT") !== accessKey.slice(35, 43) || field(ide, "cDV") !== accessKey[43] || field(ide, "tpAmb") !== "2") throw invalid();
    const participants = Object.fromEntries(([ ["sender", "rem"], ["dispatcher", "exped"], ["receiver", "receb"], ["recipient", "dest"] ] as const).map(([role, tag]) => { const element = child(info, tag, false); return [role, element ? party(element) : null]; })) as Record<"sender" | "dispatcher" | "receiver" | "recipient", Party | null>;
    const toma3 = child(ide, "toma3", false), toma4 = child(ide, "toma4", false);
    if (!!toma3 === !!toma4) throw invalid();
    const roles: Record<string, "sender" | "dispatcher" | "receiver" | "recipient"> = { "0": "sender", "1": "dispatcher", "2": "receiver", "3": "recipient" };
    const role = toma3 ? roles[field(toma3, "toma")] : "other";
    const taker = role === "other" ? party(toma4!) : role ? participants[role] : null;
    if (!role || !taker || toma4 && field(toma4, "toma") !== "4") throw invalid();
    const companyRoles: CteCompanyRole[] = [];
    for (const [name, person] of Object.entries({ carrier, ...participants, taker })) if (person?.kind === "CNPJ" && person.value === companyTaxId) companyRoles.push(name as CteCompanyRole);
    if (children(info, "autXML").some(element => { const person = party(element); return person.kind === "CNPJ" && person.value === companyTaxId; })) companyRoles.push("authorized_xml");
    if (!companyRoles.length) throw invalid();
    const digest = signatureDigest(root, cte, info, xml), protocol = child(root, "protCTe")!, receipt = child(protocol, "infProt")!;
    if (protocol.getAttribute("versao") !== "4.00" || field(receipt, "tpAmb") !== "2" || field(receipt, "chCTe") !== accessKey || field(receipt, "digVal") !== digest) throw invalid();
    // Includes aquav/detCont/infDoc: both document and selected modal passed XSD.
    const references = [...new Set(Array.from(info.getElementsByTagNameNS(NS, "infNFe")).map(element => field(element, "chave")))];
    if (references.length > 2000 || references.some(reference => !validKey(reference, "55"))) throw invalid();
    // Complement, substitution, previous documents and linked multimodal CT-e.
    const cteReferences = [...new Set(Array.from(info.getElementsByTagName("*")).filter(element => element.namespaceURI === NS && ["chCTe", "chCte", "chCTeMultimodal"].includes(element.localName)).map(element => {
      if (element.getElementsByTagName("*").length || !element.textContent) throw invalid();
      return element.textContent;
    }))];
    if (cteReferences.length > 2000 || cteReferences.some(reference => !(validKey(reference, "57") || validKey(reference, "67")) || reference === accessKey)) throw invalid();
    const values = child(info, "vPrest")!;
    return { source: "cte_distribution", schemaVersion: "4.00", profile: CTE_INSPECTION_RELEASE, environment: "homologation", companyTaxId, accessKey, number: field(ide, "nCT"), series: field(ide, "serie"), issuedAt, modal, documentType: type, carrier, ...participants, taker, takerRole: role, companyRoles,
      serviceCents: cents(field(values, "vTPrest")), receivableCents: cents(field(values, "vRec")), nfeReferences: references, cteReferences,
      protocol: { code: field(receipt, "cStat"), number: field(receipt, "nProt"), receivedAt: field(receipt, "dhRecbto"), digest }, xml, xmlSha256: createHash("sha256").update(bytes).digest("hex"),
      verification: { layout: "official_schema_valid", signature: "consistent", certificateTrust: "not_verified", currentStatus: "not_queried", protocolAuthenticity: "not_verified" } };
  } catch (error) {
    if (error instanceof CteInspectionError) throw error;
    throw invalid();
  }
}
