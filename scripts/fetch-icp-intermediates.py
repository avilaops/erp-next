"""Refresh public issuer candidates from the ITI archive, never trust anchors.

Requires Python cryptography. Run locally; review the manifest before committing.
The ERP verifies every selected path against its separate, pinned root bundle.
"""
import hashlib
import io
import json
from pathlib import Path
import re
import urllib.request
import zipfile

from cryptography import x509
from cryptography.hazmat.primitives import serialization

BASE = "https://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/"
DESTINATION = Path(__file__).resolve().parents[1] / "deploy/fiscal"


def download(name):
    with urllib.request.urlopen(BASE + name, timeout=60) as response:
        content = response.read(16 * 1024 * 1024 + 1)
    if len(content) > 16 * 1024 * 1024:
        raise ValueError("ITI download exceeds limit")
    return content


def main():
    archive = download("ACcompactado.zip")
    published = download("hashsha512.txt").decode("utf-8-sig")
    digest = hashlib.sha512(archive).hexdigest()
    if digest not in re.findall(r"[0-9a-fA-F]{128}", published.lower()):
        raise ValueError("ITI archive does not match the published SHA-512")
    certificates = {}
    with zipfile.ZipFile(io.BytesIO(archive)) as compressed:
        for entry in compressed.infolist():
            if entry.is_dir():
                continue
            if entry.file_size > 64 * 1024:
                raise ValueError("Unexpected certificate size")
            content = compressed.read(entry)
            cert = (x509.load_pem_x509_certificate(content) if b"-----BEGIN" in content
                    else x509.load_der_x509_certificate(content))
            if not cert.extensions.get_extension_for_class(x509.BasicConstraints).value.ca:
                raise ValueError("Archive contains an end entity certificate")
            if cert.subject == cert.issuer:
                continue
            der = cert.public_bytes(serialization.Encoding.DER)
            certificates[hashlib.sha256(der).hexdigest()] = cert
    if not 1 <= len(certificates) <= 4096:
        raise ValueError("Unexpected issuer count")
    ordered = sorted(certificates.items())
    pem = b"".join(cert.public_bytes(serialization.Encoding.PEM) for _, cert in ordered)
    if len(pem) > 8 * 1024 * 1024:
        raise ValueError("Issuer bundle exceeds limit")
    (DESTINATION / "icp-brasil-intermediates.pem").write_bytes(pem)
    manifest = {
        "source": BASE + "ACcompactado.zip",
        "checksumSource": BASE + "hashsha512.txt",
        "archiveSha512": digest,
        "bundleSha256": hashlib.sha256(pem).hexdigest(),
        "purpose": "Untrusted issuer candidates; never root trust anchors",
        "certificates": [{"sha256": digest, "subject": cert.subject.rfc4514_string()}
                         for digest, cert in ordered],
    }
    (DESTINATION / "icp-brasil-intermediates.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Verified ITI archive; {len(ordered)} issuer candidates, {len(pem)} bytes")


if __name__ == "__main__":
    main()
