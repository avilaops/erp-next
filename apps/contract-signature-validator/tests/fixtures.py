"""SYNTHETIC TEST ONLY. These certificates and keys are NOT ICP-Brasil."""
from datetime import datetime, timezone
from functools import lru_cache
from uuid import UUID

from asn1crypto import core
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID, ObjectIdentifier

NOW = datetime(2026, 11, 13, 15, tzinfo=timezone.utc)
DOCUMENT = UUID("11111111-1111-4111-8111-111111111111")
PARTICIPANT = UUID("22222222-2222-4222-8222-222222222222")
CPF = "52998224725"
PERSON_OID = "2.16.76.1.3.1"


@lru_cache(maxsize=1)
def test_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def certificate(*, cpf=CPF, policy="2.16.76.1.2.1.999999", policies=None, attributes=None, ca=False):
    """Build only local test bytes. No real identity or trusted CA is represented."""
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "SYNTHETIC NOT ICP TEST")])
    builder = (
        x509.CertificateBuilder()
        .subject_name(subject).issuer_name(subject).public_key(test_key().public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime(2026, 1, 1, tzinfo=timezone.utc))
        .not_valid_after(datetime(2027, 1, 1, tzinfo=timezone.utc))
        .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True)
        .add_extension(x509.KeyUsage(
            digital_signature=True, content_commitment=not ca, key_encipherment=False,
            data_encipherment=False, key_agreement=False, key_cert_sign=ca,
            crl_sign=ca, encipher_only=None, decipher_only=None,
        ), critical=True)
        .add_extension(x509.CertificatePolicies([
            x509.PolicyInformation(ObjectIdentifier(value), None) for value in (policies or [policy])
        ]), critical=False)
    )
    if attributes is None:
        attributes = [(PERSON_OID, core.UTF8String("01011990" + cpf + "0" * 39).dump())]
    if attributes:
        builder = builder.add_extension(x509.SubjectAlternativeName([
            x509.OtherName(ObjectIdentifier(oid), value) for oid, value in attributes
        ]), critical=False)
    return builder.sign(test_key(), hashes.SHA256()).public_bytes(serialization.Encoding.DER)


def binding_values():
    return dict(document_id=DOCUMENT, participant_id=PARTICIPANT, parent_sha256="a" * 64,
                candidate_sha256="b" * 64, policy_sha256="c" * 64,
                trust_bundle_sha256="d" * 64, checked_at=NOW)
