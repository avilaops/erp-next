import { createHash, createSign } from "node:crypto";
import forge from "node-forge";
import { CertificateError } from "@/lib/fiscal/certificate";

/**
 * The signature of the NF-e: XML-DSig enveloped, canonical XML 1.0, SHA-1 and
 * RSA-SHA1, as the layout 4.00 prescribes. The XML comes from `buildNfeXml`,
 * which writes it already in canonical form (no white space between tags, no
 * empty tags, text escaped the canonical way), so the canonical `infNFe` is
 * the same text with the namespace written on it, and nothing here parses XML.
 * Checked in the tests by an independent implementation (xml-crypto).
 */

const NFE_NS = "http://www.portalfiscal.inf.br/nfe";
const DSIG_NS = "http://www.w3.org/2000/09/xmldsig#";
const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";

export type SigningKey = {
  /** The private key, PEM. It never leaves the server and is never logged. */
  privateKeyPem: string;
  /** The certificate of the company, DER in base64, as `X509Certificate` carries it. */
  certificateBase64: string;
  /** Intermediate certificates from the PFX, for PDF/CMS chain construction. */
  certificateChainBase64?: string[];
};

/** The key and the certificate of the company out of its A1 file. */
export function signingKeyOf(pfx: Uint8Array, password: string): SigningKey {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(pfx).toString("binary"))), password);
  } catch {
    throw new CertificateError("Não foi possível abrir o certificado: arquivo ou senha inválidos.");
  }
  const keyBag = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ].find((bag) => bag.key);
  if (!keyBag?.key) throw new CertificateError("O certificado não traz a chave privada: envie o arquivo A1 (.pfx) completo.");

  // The certificate of the key itself, not one of the chain: the one whose public key matches.
  const modulus = (keyBag.key as forge.pki.rsa.PrivateKey).n.toString(16);
  const certificates = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).flatMap((bag) => (bag.cert ? [bag.cert] : []));
  const own = certificates.find((certificate) => (certificate.publicKey as forge.pki.rsa.PublicKey).n.toString(16) === modulus);
  if (!own) throw new CertificateError("O arquivo não traz o certificado da própria chave.");

  return {
    privateKeyPem: forge.pki.privateKeyToPem(keyBag.key),
    certificateBase64: forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(own)).getBytes()),
    certificateChainBase64: certificates.filter((cert) => cert !== own).map((cert) => forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes())),
  };
}

/** The signature of one element, already in canonical form, referenced by its `Id`. */
function signatureOf(canonical: string, id: string, key: SigningKey): string {
  const digest = createHash("sha1").update(canonical, "utf8").digest("base64");
  const signedInfo = (namespace: string) =>
    `<SignedInfo${namespace}><CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod>` +
    `<Reference URI="#${id}"><Transforms><Transform Algorithm="${ENVELOPED}"></Transform><Transform Algorithm="${C14N}"></Transform></Transforms>` +
    `<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
  // Canonical SignedInfo carries the namespace of the Signature it lives in.
  const value = createSign("RSA-SHA1").update(signedInfo(` xmlns="${DSIG_NS}"`), "utf8").sign(key.privateKeyPem, "base64");
  return (
    `<Signature xmlns="${DSIG_NS}">${signedInfo("")}<SignatureValue>${value}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${key.certificateBase64}</X509Certificate></X509Data></KeyInfo></Signature>`
  );
}

const NOT_CANONICAL = /<\w+\/>|<!--|<\?|<!\[CDATA\[|\r/;

/**
 * Signs the `infNFe` of an invoice built by `buildNfeXml` and answers with the
 * whole `NFe`, signature inside. Anything that is not exactly that shape is
 * refused: the canonical form is only known for what this system wrote.
 */
export function signNfeXml(xml: string, key: SigningKey): string {
  const match = /^(<\?xml version="1\.0" encoding="UTF-8"\?>)<NFe xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe"><infNFe versao="4\.00" Id="(NFe\d{6}[0-9A-Z]{12}\d{26})">([\s\S]*)<\/infNFe><\/NFe>$/.exec(xml);
  if (!match) throw new Error("O XML a assinar não é o que este sistema monta.");
  const [, declaration, id, body] = match;
  if (NOT_CANONICAL.test(body)) throw new Error("O XML a assinar não está na forma canônica.");
  // Canonical infNFe: the namespace it inherits written on it, then the attributes in alphabetical order.
  const signature = signatureOf(`<infNFe xmlns="${NFE_NS}" Id="${id}" versao="4.00">${body}</infNFe>`, id, key);
  return `${declaration}<NFe xmlns="${NFE_NS}"><infNFe versao="4.00" Id="${id}">${body}</infNFe>${signature}</NFe>`;
}

/** Signs the `infEvento` of an event built by `eventXml` (cancellation, correction letter) and answers with the whole `evento`. */
export function signEventXml(xml: string, key: SigningKey): string {
  const match = /^<evento xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe" versao="1\.00"><infEvento Id="(ID\d{12}[0-9A-Z]{12}\d{28})">([\s\S]*)<\/infEvento><\/evento>$/.exec(xml);
  if (!match) throw new Error("O evento a assinar não é o que este sistema monta.");
  const [, id, body] = match;
  if (NOT_CANONICAL.test(body)) throw new Error("O evento a assinar não está na forma canônica.");
  const signature = signatureOf(`<infEvento xmlns="${NFE_NS}" Id="${id}">${body}</infEvento>`, id, key);
  return `<evento xmlns="${NFE_NS}" versao="1.00"><infEvento Id="${id}">${body}</infEvento>${signature}</evento>`;
}

/** Signs the `infInut` of a request built by `voidXml` (numbers made unusable) and answers with the whole `inutNFe`. */
export function signVoidXml(xml: string, key: SigningKey): string {
  const match = /^<inutNFe xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe" versao="4\.00"><infInut Id="(ID\d{4}[0-9A-Z]{12}\d{25})">([\s\S]*)<\/infInut><\/inutNFe>$/.exec(xml);
  if (!match) throw new Error("O pedido a assinar não é o que este sistema monta.");
  const [, id, body] = match;
  if (NOT_CANONICAL.test(body)) throw new Error("O pedido a assinar não está na forma canônica.");
  const signature = signatureOf(`<infInut xmlns="${NFE_NS}" Id="${id}">${body}</infInut>`, id, key);
  return `<inutNFe xmlns="${NFE_NS}" versao="4.00"><infInut Id="${id}">${body}</infInut>${signature}</inutNFe>`;
}
