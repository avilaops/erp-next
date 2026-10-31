"""Generate public synthetic test credentials, never use this CA in production."""
import base64
from datetime import datetime, timezone
import json
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID, ObjectIdentifier


def key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def certificate(name, public_key, issuer, issuer_key, ca, expired=False, client=True):
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
    builder = (x509.CertificateBuilder().subject_name(subject)
               .issuer_name(issuer.subject if issuer else subject)
               .public_key(public_key).serial_number(x509.random_serial_number())
               .not_valid_before(datetime(2025, 1, 1, tzinfo=timezone.utc))
               .not_valid_after(datetime(2026 if expired else 2030, 1, 1, tzinfo=timezone.utc))
               .add_extension(x509.BasicConstraints(ca=ca, path_length=1 if ca else None), True)
               .add_extension(x509.KeyUsage(True, False, False, False, False, ca, ca, False, False), True))
    if not ca:
        builder = (builder.add_extension(x509.SubjectAlternativeName([
            x509.OtherName(ObjectIdentifier("2.16.76.1.3.3"), b"\x0c\x0e04252011000110")]), False)
            .add_extension(x509.CertificatePolicies([
                x509.PolicyInformation(ObjectIdentifier("2.16.76.1.2.1.999"), None)]), False)
            .add_extension(x509.ExtendedKeyUsage([
                ExtendedKeyUsageOID.CLIENT_AUTH if client else ExtendedKeyUsageOID.SERVER_AUTH]), False))
    return builder.sign(issuer_key, hashes.SHA256())


def main():
    root_key, ca_key, leaf_key = key(), key(), key()
    root = certificate("Synthetic root - NOT ICP Brasil", root_key.public_key(), None, root_key, True)
    ca = certificate("Synthetic intermediate", ca_key.public_key(), root, root_key, True)
    expired_ca = certificate("Synthetic intermediate", ca_key.public_key(), root, root_key, True, expired=True)
    leaf = certificate("Synthetic company", leaf_key.public_key(), ca, ca_key, False)
    incompatible = certificate("Synthetic company", leaf_key.public_key(), ca, ca_key, False, client=False)
    password = b"public-synthetic-test-only"

    def export(cert, chain):
        return base64.b64encode(pkcs12.serialize_key_and_certificates(
            b"synthetic", leaf_key, cert, chain,
            serialization.BestAvailableEncryption(password))).decode()

    def pem(cert):
        return cert.public_bytes(serialization.Encoding.PEM).decode()

    fixture = {"password": password.decode(), "rootPem": pem(root), "intermediatePem": pem(ca),
               "expiredIntermediatePem": pem(expired_ca), "leafOnly": export(leaf, None),
               "complete": export(leaf, [ca]), "incompatibleUsage": export(incompatible, None)}
    destination = Path(__file__).resolve().parents[1] / "apps/api/tests/fixtures/a1-chain-synthetic.json"
    destination.write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
