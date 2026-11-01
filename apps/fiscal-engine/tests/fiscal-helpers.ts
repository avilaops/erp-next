import forge from "node-forge";

/**
 * A self-signed certificate with its key, packed as a `.pfx` with a password:
 * what an A1 file looks like. Only for tests. The CNPJ goes in the name, as
 * ICP-Brasil writes it (`RAZAO SOCIAL:CNPJ`).
 */
export function testPfx({
  name = "ACADEMIA TESTE LTDA:48240052000161",
  password = "senha-de-teste",
  from = new Date("2026-01-01T00:00:00Z"),
  until = new Date("2027-01-01T00:00:00Z"),
  withKey = true,
  bits = 1024,
}: { name?: string; password?: string; from?: Date; until?: Date; withKey?: boolean; bits?: number } = {}): Uint8Array {
  // 1024 keeps the tests fast; a TLS handshake needs 2048.
  const keys = forge.pki.rsa.generateKeyPair({ bits, e: 0x10001 });
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = "01";
  certificate.validity.notBefore = from;
  certificate.validity.notAfter = until;
  const subject = [{ name: "commonName", value: name }];
  certificate.setSubject(subject);
  certificate.setIssuer(subject);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(withKey ? keys.privateKey : null, [certificate], password, { algorithm: "3des" });
  return new Uint8Array(Buffer.from(forge.asn1.toDer(asn1).getBytes(), "binary"));
}

/** A certificate for `localhost`, with its key in PEM: the stand-in for a server the system talks to over TLS. */
export function serverIdentity(): { key: string; cert: string } {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = "03";
  certificate.validity.notBefore = new Date(Date.now() - 86_400_000);
  certificate.validity.notAfter = new Date(Date.now() + 86_400_000);
  const name = [{ name: "commonName", value: "localhost" }];
  certificate.setSubject(name);
  certificate.setIssuer(name);
  certificate.setExtensions([{ name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }] }, { name: "basicConstraints", cA: true }]);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  return { key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(certificate) };
}
