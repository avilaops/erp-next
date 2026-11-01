import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import forge from "node-forge";

/** A refusal the user can act on. The message goes to the screen as it is. */
export class CertificateError extends Error {}

/** The file is a certificate, but the password typed does not open it. */
export class WrongPasswordError extends CertificateError {}

/** What identifies a certificate, read from the file itself. Nothing secret here. */
export type CertificateInfo = {
  /** The name it was issued to, as written in it. */
  subject: string;
  /** CNPJ of the holder, when the certificate carries one (ICP-Brasil e-CNPJ does). */
  holderCnpj: string | null;
  validFrom: Date;
  validUntil: Date;
  /** SHA-256 of the public certificate. */
  fingerprint: string;
};

const MAX_BYTES = 64 * 1024;
/** ICP-Brasil: the field of an e-CNPJ certificate that holds the CNPJ. */
const OID_CNPJ = "2.16.76.1.3.3";

/**
 * Opens an A1 certificate (`.pfx` / `.p12`) with its password and reads who it
 * belongs to and until when it is valid. A wrong password, a file that is not a
 * certificate, or one without the private key (it could not sign) is refused.
 */
export function readCertificate(pfx: Uint8Array, password: string): CertificateInfo {
  if (pfx.length === 0) throw new CertificateError("Escolha o arquivo do certificado (.pfx ou .p12).");
  if (pfx.length > MAX_BYTES) throw new CertificateError("Arquivo grande demais para ser um certificado A1.");

  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(pfx).toString("binary")));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  } catch (error) {
    // The library tells a wrong password from a file that is not a certificate; the person is told which one it was.
    if (error instanceof Error && /Invalid password|MAC could not be verified/i.test(error.message)) {
      throw new WrongPasswordError("A senha não confere com este certificado. Confira maiúsculas, minúsculas e símbolos (um * no fim, por exemplo): toque em Mostrar para ver o que foi digitado.");
    }
    throw new CertificateError("Não foi possível ler o arquivo como certificado. Envie o arquivo .pfx ou .p12 do certificado A1.");
  }

  const keys = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  if (keys.length === 0) throw new CertificateError("Este arquivo não traz a chave privada: com ele não dá para assinar nota.");

  const bags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const certificates = bags.flatMap((bag) => (bag.cert ? [bag.cert] : []));
  // The holder's certificate is the one that is not an authority.
  const own = certificates.find((certificate) => !(certificate.getExtension("basicConstraints") as { cA?: boolean } | null)?.cA) ?? certificates[0];
  if (!own) throw new CertificateError("Este arquivo não traz certificado nenhum.");

  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(own)).getBytes();
  return {
    subject: String(own.subject.getField("CN")?.value ?? "certificado sem nome"),
    holderCnpj: holderCnpj(own),
    validFrom: own.validity.notBefore,
    validUntil: own.validity.notAfter,
    fingerprint: createHash("sha256").update(Buffer.from(der, "binary")).digest("hex"),
  };
}

/** The CNPJ from the ICP-Brasil field, or from a name written as `RAZAO SOCIAL:CNPJ`. */
function holderCnpj(certificate: forge.pki.Certificate): string | null {
  const alternative = certificate.getExtension("subjectAltName") as { altNames?: { type: number; value: unknown }[] } | null;
  for (const name of alternative?.altNames ?? []) {
    // type 0 is "otherName": [oid, [0] value].
    if (name.type !== 0 || !Array.isArray(name.value)) continue;
    const [oid, wrapped] = name.value as forge.asn1.Asn1[];
    if (!oid || !wrapped || forge.asn1.derToOid(oid.value as string) !== OID_CNPJ) continue;
    const inner = Array.isArray(wrapped.value) ? (wrapped.value[0] as forge.asn1.Asn1 | undefined)?.value : wrapped.value;
    // Digits only, or with letters in the first twelve positions (alphanumeric CNPJ, NT Conjunta 2025.001).
    const holder = String(inner ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    if (/^[0-9A-Z]{12}\d{2}$/.test(holder)) return holder;
  }
  const fromName = /:([0-9A-Z]{12}\d{2})$/.exec(String(certificate.subject.getField("CN")?.value ?? ""));
  return fromName ? fromName[1] : null;
}

/** The certificate and its password, sealed. Only who has the key opens it. */
export type SealedCertificate = { ciphertext: Buffer; iv: Buffer; authTag: Buffer };

/** The key of the vault, from its text form: 32 bytes in base64. Anything else is an error. */
export function vaultKey(text: string | undefined): Buffer {
  const key = Buffer.from((text ?? "").trim(), "base64");
  if (key.length !== 32) throw new Error("ERP_CERT_KEY ausente ou inválida: precisa ser uma chave de 32 bytes em base64.");
  return key;
}

/** Seals the file and its password together with AES-256-GCM. Each sealing has its own random IV. */
export function sealCertificate(pfx: Uint8Array, password: string, key: Buffer): SealedCertificate {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plain = Buffer.from(JSON.stringify({ pfx: Buffer.from(pfx).toString("base64"), password }), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

/** Opens what `sealCertificate` sealed. A wrong key or a changed byte throws: nothing half-opened comes out. */
export function openCertificate(sealed: SealedCertificate, key: Buffer): { pfx: Buffer; password: string } {
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.iv);
  decipher.setAuthTag(sealed.authTag);
  let plain: Buffer;
  try {
    plain = Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
  } catch {
    throw new Error("Não foi possível abrir o certificado guardado: a chave do cofre não é a que o selou, ou o conteúdo foi alterado.");
  }
  const { pfx, password } = JSON.parse(plain.toString("utf8")) as { pfx: string; password: string };
  return { pfx: Buffer.from(pfx, "base64"), password };
}
