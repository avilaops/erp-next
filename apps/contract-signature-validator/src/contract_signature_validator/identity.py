"""Structural identity only: acceptance here does not establish PKI trust."""
import re

from asn1crypto import core, x509

from .model import CertificateIdentity, Verdict, valid_cpf

PERSON = "2.16.76.1.3.1"
COMPANY = {"2.16.76.1.3.2", "2.16.76.1.3.3", "2.16.76.1.3.4", "2.16.76.1.3.8"}
PERSONAL_POLICIES = tuple(f"2.16.76.1.2.{kind}." for kind in (1, 2, 3, 4))
NONPERSONAL_POLICIES = tuple(f"2.16.76.1.2.{kind}." for kind in (101, 102, 103, 104, 201, 202, 303, 304, 401, 402))


def _result(kind, verdict, reason, cpf=None):
    return CertificateIdentity(kind, verdict, reason, cpf)


def extract_personal_identity(cert_der: bytes) -> CertificateIdentity:
    if not isinstance(cert_der, bytes) or not 0 < len(cert_der) <= 256 * 1024:
        return _result("unknown", Verdict.INVALID, "invalid_certificate")
    try:
        cert = x509.Certificate.load(cert_der, strict=True)
        extensions = cert["tbs_certificate"]["extensions"]
        policies_ext = [e for e in extensions if e["extn_id"].native == "certificate_policies"]
        if len(policies_ext) != 1:
            return _result("unknown", Verdict.UNSUPPORTED, "certificate_policy_unsupported")
        policies = [p["policy_identifier"].dotted for p in policies_ext[0]["extn_value"].parsed]
        if len(policies) != len(set(policies)):
            return _result("unknown", Verdict.INVALID, "certificate_policy_ambiguous")
        if any(p.startswith(NONPERSONAL_POLICIES) for p in policies):
            return _result("technical", Verdict.INVALID, "personal_certificate_required")
        if not any(p.startswith(PERSONAL_POLICIES) for p in policies):
            return _result("unknown", Verdict.UNSUPPORTED, "certificate_policy_unsupported")
        sans = [e for e in extensions if e["extn_id"].native == "subject_alt_name"]
        if len(sans) != 1:
            return _result("unknown", Verdict.INVALID, "personal_identity_missing")
        attributes = [n.chosen for n in sans[0]["extn_value"].parsed if n.name == "other_name"]
        if any(n["type_id"].dotted in COMPANY for n in attributes):
            return _result("e_cnpj", Verdict.INVALID, "personal_certificate_required")
        holders = [n for n in attributes if n["type_id"].dotted == PERSON]
        if len(holders) != 1:
            return _result("unknown", Verdict.INVALID, "personal_identity_ambiguous")
        encoded = holders[0]["value"].parsed
        if not isinstance(encoded, (core.UTF8String, core.PrintableString, core.IA5String, core.OctetString)):
            return _result("unknown", Verdict.INVALID, "personal_identity_encoding")
        raw = encoded.native
        if isinstance(raw, bytes):
            raw = raw.decode("ascii", errors="strict")
        if not isinstance(raw, str) or not 19 <= len(raw) <= 128 or not re.fullmatch(r"[0-9]{8}", raw[:8]):
            return _result("unknown", Verdict.INVALID, "personal_identity_encoding")
        cpf = raw[8:19]
        if not valid_cpf(cpf):
            return _result("unknown", Verdict.INVALID, "invalid_cpf")
        return _result("e_cpf", Verdict.ACCEPTED, "personal_identity_extracted", cpf)
    except (ValueError, TypeError, KeyError, UnicodeError):
        # Never return parser exception text: certificate DNs can contain CPF/DOB.
        return _result("unknown", Verdict.INVALID, "invalid_certificate")
