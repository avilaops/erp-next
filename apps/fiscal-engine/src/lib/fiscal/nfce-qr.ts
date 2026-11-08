import { createHash, createSign, verify, X509Certificate } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import type { Element } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";
import { ACCESS_KEY_PATTERN, accessKeyDigit, accessKeyUf } from "./nfe.ts";
import { assertFiscalXml, FiscalXmlError } from "./local-layout.ts";
import type { SigningKey } from "./sign.ts";

export type NfceQrProfile =
  | { version: "2"; csc: { id: string; secret: string } }
  | { version: "3"; signingKey?: SigningKey };

export type NfceQrPayload = {
  version: "2" | "3"; mode: "online" | "offline";
  environment: "production" | "homologation"; accessKey: string;
  payload: string; sourceSha256: string;
};

export class NfceQrError extends Error {
  readonly reason: "invalid" | "unavailable";

  constructor(reason: "invalid" | "unavailable") {
    super(reason === "invalid" ? "Não foi possível compor o QR Code: XML, assinatura ou perfil de NFC-e inválido." : "A conferência local da NFC-e está indisponível.");
    this.name = "NfceQrError";
    this.reason = reason;
  }
}

const NFE = "http://www.portalfiscal.inf.br/nfe";
const DSIG = "http://www.w3.org/2000/09/xmldsig#";
const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const ENVELOPED = `${DSIG}enveloped-signature`;
const invalid = () => new NfceQrError("invalid");

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function only(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

function profileOf(value: unknown): NfceQrProfile {
  if (!record(value)) throw invalid();
  if (value.version === "2") {
    if (!only(value, ["version", "csc"]) || !record(value.csc) || !only(value.csc, ["id", "secret"])) throw invalid();
    const { id, secret } = value.csc;
    if (typeof id !== "string" || !/^[0-9]{1,6}$/.test(id) || typeof secret !== "string" || !/^[A-Za-z0-9-]{16,36}$/.test(secret)) throw invalid();
    return { version: "2", csc: { id, secret } };
  } else if (value.version === "3") {
    if (!only(value, ["version", "signingKey"])) throw invalid();
    if (value.signingKey === undefined) return { version: "3" };
    const key = value.signingKey;
    if (!record(key) || typeof key.privateKeyPem !== "string" || key.privateKeyPem.length > 32_768 ||
      typeof key.certificateBase64 !== "string" || key.certificateBase64.length > 16_384) throw invalid();
    return { version: "3", signingKey: { privateKeyPem: key.privateKeyPem, certificateBase64: key.certificateBase64 } };
  } else throw invalid();
}

function child(parent: Element, name: string, namespace = NFE, required = true): Element | null {
  const found: Element[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) if (node.nodeType === 1) {
    const element = node as Element;
    if (element.localName === name && element.namespaceURI === namespace) found.push(element);
  }
  if (found.length > 1 || (required && found.length !== 1)) throw invalid();
  return found[0] ?? null;
}

function field(parent: Element, name: string, namespace = NFE): string {
  const element = child(parent, name, namespace)!;
  if (element.getElementsByTagName("*").length || !element.textContent) throw invalid();
  return element.textContent;
}

/** Consistency with the embedded certificate, not a trust-chain or SEFAZ authorization check. */
function checkedSignature(root: Element, info: Element, xml: string): { digest: string; certificate: X509Certificate } {
  const signature = child(root, "Signature", DSIG)!;
  if (root.getElementsByTagNameNS(DSIG, "Signature").length !== 1) throw invalid();
  const signedInfo = child(signature, "SignedInfo", DSIG)!;
  if (child(signedInfo, "CanonicalizationMethod", DSIG)!.getAttribute("Algorithm") !== C14N ||
    child(signedInfo, "SignatureMethod", DSIG)!.getAttribute("Algorithm") !== `${DSIG}rsa-sha1`) throw invalid();
  const reference = child(signedInfo, "Reference", DSIG)!;
  const id = info.getAttribute("Id");
  if (!id || reference.getAttribute("URI") !== `#${id}` || child(reference, "DigestMethod", DSIG)!.getAttribute("Algorithm") !== `${DSIG}sha1`) throw invalid();
  const transforms = child(reference, "Transforms", DSIG)!;
  const algorithms = Array.from(transforms.getElementsByTagNameNS(DSIG, "Transform")).map(node => node.getAttribute("Algorithm"));
  if (algorithms.length !== 2 || algorithms[0] !== ENVELOPED || algorithms[1] !== C14N) throw invalid();
  // Reject any other potential target for XML-DSig's case-insensitive Id lookup.
  const elements = [root, ...Array.from(root.getElementsByTagName("*"))];
  for (const element of elements) for (const attribute of Array.from(element.attributes)) {
    if (attribute.localName.toLowerCase() === "id" && (element !== info || attribute.name !== "Id" || attribute.value !== id)) throw invalid();
  }
  const encoded = field(child(child(signature, "KeyInfo", DSIG)!, "X509Data", DSIG)!, "X509Certificate", DSIG).replace(/\s/g, "");
  if (encoded.length > 16_384 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw invalid();
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) throw invalid();
  const certificate = new X509Certificate(bytes);
  if (certificate.publicKey.asymmetricKeyType !== "rsa" || (certificate.publicKey.asymmetricKeyDetails?.modulusLength ?? 0) > 8192) throw invalid();
  const checker = new SignedXml({ publicCert: certificate.toString(), getCertFromKeyInfo: () => null });
  checker.loadSignature(signature);
  if (!checker.checkSignature(xml) || checker.getReferences().length !== 1) throw invalid();
  const digest = field(reference, "DigestValue", DSIG);
  if (!/^[A-Za-z0-9+/]{27}=$/.test(digest) || Buffer.from(digest, "base64").toString("base64") !== digest) throw invalid();
  return { digest, certificate };
}

function boundKey(info: Element, model: "55" | "65"): { accessKey: string; day: string; mode: "online" | "offline"; environment: "production" | "homologation"; ambient: string } {
  const accessKey = (info.getAttribute("Id") ?? "").replace(/^NFe/, "");
  if (!ACCESS_KEY_PATTERN.test(accessKey) || !accessKeyUf(accessKey) || accessKeyDigit(accessKey.slice(0, 43)) !== accessKey[43]) throw invalid();
  const ide = child(info, "ide")!, issuer = child(info, "emit")!;
  const cnpj = child(issuer, "CNPJ", NFE, false), cpf = child(issuer, "CPF", NFE, false);
  if (!!cnpj === !!cpf) throw invalid();
  const issuerId = field(issuer, cnpj ? "CNPJ" : "CPF").padStart(14, "0");
  const issuedAt = field(ide, "dhEmi"), emission = field(ide, "tpEmis"), ambient = field(ide, "tpAmb");
  if (field(ide, "mod") !== model || !["1", "3", "4", "9"].includes(emission) || !["1", "2"].includes(ambient)) throw invalid();
  if (field(ide, "cUF") !== accessKey.slice(0, 2) || issuedAt.slice(2, 4) + issuedAt.slice(5, 7) !== accessKey.slice(2, 6) ||
    issuerId !== accessKey.slice(6, 20) || accessKey.slice(20, 22) !== model || field(ide, "serie").padStart(3, "0") !== accessKey.slice(22, 25) ||
    field(ide, "nNF").padStart(9, "0") !== accessKey.slice(25, 34) || emission !== accessKey[34] ||
    field(ide, "cNF") !== accessKey.slice(35, 43) || field(ide, "cDV") !== accessKey[43]) throw invalid();
  return { accessKey, day: issuedAt.slice(8, 10), mode: emission === "9" ? "offline" : "online", environment: ambient === "1" ? "production" : "homologation", ambient };
}

function recipientParameters(info: Element): string[] {
  const dest = child(info, "dest", NFE, false);
  if (!dest) return ["", ""];
  const kinds = ["CNPJ", "CPF", "idEstrangeiro"].filter(name => child(dest, name, NFE, false));
  if (kinds.length !== 1) throw invalid();
  return kinds[0] === "idEstrangeiro" ? ["3", ""] : [kinds[0] === "CNPJ" ? "1" : "2", field(dest, kinds[0])];
}

function signParameters(prefix: string, key: SigningKey | undefined, certificate: X509Certificate): string {
  if (!record(key) || typeof key.privateKeyPem !== "string" || key.privateKeyPem.length > 32_768 || typeof key.certificateBase64 !== "string" ||
    key.certificateBase64.length > 16_384 || !new X509Certificate(Buffer.from(key.certificateBase64, "base64")).raw.equals(certificate.raw)) throw invalid();
  const signature = createSign("RSA-SHA1").update(prefix, "utf8").sign(key.privateKeyPem);
  if (!verify("RSA-SHA1", Buffer.from(prefix, "utf8"), certificate.publicKey, signature)) throw invalid();
  return signature.toString("base64");
}

/** Private, offline composition only. No URL defaults, transport, certificate loading or issuance. */
export async function createFiscalQrPayload(input: { signedXml: string; profile: NfceQrProfile }, model: "55" | "65"): Promise<NfceQrPayload> {
  try {
    if (!record(input) || !only(input, ["signedXml", "profile"])) throw invalid();
    const profile = profileOf(input.profile), xml = input.signedXml;
    if (typeof xml !== "string" || !xml || Buffer.byteLength(xml, "utf8") > 1_048_576 || /\0|<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw invalid();
    const source = Buffer.from(xml, "utf8");
    if (source.toString("utf8") !== xml) throw invalid();
    const declaration = /^\uFEFF?<\?xml\b([\s\S]*?)\?>/.exec(xml)?.[1];
    const encoding = declaration && /\bencoding\s*=\s*(["'])(.*?)\1/i.exec(declaration)?.[2];
    const version = declaration && /\bversion\s*=\s*(["'])(.*?)\1/i.exec(declaration)?.[2];
    if (encoding && !/^UTF-8$/i.test(encoding) || version && version !== "1.0") throw invalid();
    await assertFiscalXml(xml, "nfe");
    const document = new DOMParser({ onError: () => { throw invalid(); } }).parseFromString(xml.replace(/^\uFEFF/, ""), "application/xml");
    const root = document.documentElement;
    if (!root || root.localName !== "NFe" || root.namespaceURI !== NFE || root.getElementsByTagName("*").length > 50_000) throw invalid();
    const info = child(root, "infNFe")!;
    if (model === "55" && (profile.version !== "3" || field(child(info, "ide")!, "tpImp") !== "6")) throw invalid();
    const bound = boundKey(info, model), signature = checkedSignature(root, info, xml);
    const parameters = [bound.accessKey, profile.version, bound.ambient];
    if (bound.mode === "offline") {
      const amount = field(child(child(info, "total")!, "ICMSTot")!, "vNF");
      if (!/^(0|[1-9][0-9]{0,12})(?:\.[0-9]{2})?$/.test(amount)) throw invalid();
      parameters.push(bound.day, amount);
      if (profile.version === "2") parameters.push(Buffer.from(signature.digest, "utf8").toString("hex"));
      else parameters.push(...recipientParameters(info));
    }
    if (profile.version === "2") {
      parameters.push(profile.csc.id.replace(/^0+(?=\d)/, ""));
      parameters.push(createHash("sha1").update(parameters.join("|") + profile.csc.secret, "utf8").digest("hex").toUpperCase());
    } else if (bound.mode === "offline") parameters.push(signParameters(parameters.join("|"), profile.signingKey, signature.certificate));
    else if (profile.signingKey !== undefined) throw invalid();
    return { version: profile.version, mode: bound.mode, environment: bound.environment, accessKey: bound.accessKey, payload: parameters.join("|"), sourceSha256: createHash("sha256").update(source).digest("hex") };
  } catch (error) {
    if (error instanceof NfceQrError) throw error;
    throw new NfceQrError(error instanceof FiscalXmlError && error.reason === "unavailable" ? "unavailable" : "invalid");
  }
}

export async function createNfceQrPayload(input: { signedXml: string; profile: NfceQrProfile }): Promise<NfceQrPayload> {
  return createFiscalQrPayload(input, "65");
}
