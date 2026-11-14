"""Untrusted certificate parsing belongs only inside the resource-limited offline worker."""
from dataclasses import replace
import hashlib
import re

from asn1crypto import crl as asn1_crl, ocsp as asn1_ocsp
from cryptography import x509
from cryptography.exceptions import InvalidSignature, UnsupportedAlgorithm
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.serialization import pkcs7
from cryptography.x509 import ocsp
from cryptography.x509.oid import AuthorityInformationAccessOID, ExtensionOID
from contract_signature_validator.model import EvidenceSet
from contract_signature_validator.pdf_policy import open_pdf

from .egress import EgressError, FetchTarget

_CERTS = re.compile(rb'-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\r\n\t ]+-----END CERTIFICATE-----')


class DiscoveryError(ValueError):
    def __init__(self):
        super().__init__('validation_evidence_limit')


def _certificates(raw):
    try:
        if raw.lstrip().startswith(b'-----BEGIN CERTIFICATE-----'):
            if _CERTS.sub(b'', raw).strip():
                return ()
            values = x509.load_pem_x509_certificates(raw)
        elif raw.lstrip().startswith(b'-----BEGIN PKCS7-----'):
            values = pkcs7.load_pem_pkcs7_certificates(raw)
        else:
            try:
                values = (x509.load_der_x509_certificate(raw),)
            except ValueError:
                values = pkcs7.load_der_pkcs7_certificates(raw)
        return tuple(value.public_bytes(serialization.Encoding.DER) for value in values)
    except (ValueError, TypeError, UnsupportedAlgorithm):
        return ()


def normalize_evidence(evidence):
    """Discard syntactically unusable downloads; never discard a parsed negative status."""
    if not isinstance(evidence, EvidenceSet):
        raise DiscoveryError()
    certificates = {value for raw in evidence.certificates for value in _certificates(raw)}
    crls, ocsps = set(), set()
    for raw in evidence.crls:
        try:
            value = raw
            if raw.lstrip().startswith(b'-----BEGIN X509 CRL-----'):
                value = x509.load_pem_x509_crl(raw).public_bytes(serialization.Encoding.DER)
            parsed = asn1_crl.CertificateList.load(value, strict=True)
            parsed['tbs_cert_list']['this_update'].native
            parsed['signature'].native
            crls.add(value)
        except (ValueError, TypeError, KeyError, UnsupportedAlgorithm):
            continue
    for raw in evidence.ocsps:
        try:
            parsed = asn1_ocsp.OCSPResponse.load(raw, strict=True)
            if parsed['response_status'].native == 'successful':
                parsed['response_bytes']['response'].parsed['tbs_response_data'].native
            ocsps.add(raw)
        except (ValueError, TypeError, KeyError):
            continue
    try:
        return EvidenceSet(evidence.observed_at, tuple(sorted(certificates)), tuple(sorted(crls)), tuple(sorted(ocsps)))
    except ValueError:
        raise DiscoveryError() from None


def embedded_evidence(data, baseline_count, evidence, policy, *, base=False):
    reader = open_pdf(data, policy, base=base)
    signatures = reader.embedded_signatures
    if len(signatures) > policy.max_signatures:
        raise DiscoveryError()
    certificates = set(evidence.certificates)
    personal = []
    for index, signature in enumerate(signatures):
        for choice in signature.signed_data['certificates']:
            if choice.name == 'certificate':
                raw = choice.chosen.dump()
                if len(raw) > 256*1024:
                    raise DiscoveryError()
                certificates.add(raw)
        if index >= baseline_count:
            personal.append(signature.signer_cert.dump())
    try:
        return replace(evidence, certificates=tuple(sorted(certificates))), tuple(personal)
    except ValueError:
        raise DiscoveryError() from None


def _extension(certificate, oid):
    try:
        return certificate.extensions.get_extension_for_oid(oid).value
    except x509.ExtensionNotFound:
        return ()


def discover_targets(personal_der, evidence, trust, network_policy):
    """Follow only signature-verified issuer links. Returned URLs still need pinned egress checks."""
    try:
        pool = {raw: x509.load_der_x509_certificate(raw)
                for raw in (*trust.root_der, *trust.intermediate_der, *evidence.certificates)}
        roots = set(trust.root_der)
        by_subject = {}
        for raw, certificate in sorted(pool.items()):
            by_subject.setdefault(certificate.subject.public_bytes(), []).append((raw, certificate))
        queue, visited, targets, scanned = list(personal_der), set(), [], 0
        while queue and len(visited) < 64 and len(targets) < 12:
            raw = queue.pop(0)
            if raw in visited or raw in roots:
                continue
            visited.add(raw)
            certificate = pool.get(raw) or x509.load_der_x509_certificate(raw)
            issuer = None
            for candidate_raw, candidate in by_subject.get(certificate.issuer.public_bytes(), ())[:16]:
                try:
                    certificate.verify_directly_issued_by(candidate)
                    issuer = candidate
                    queue.append(candidate_raw)
                    break
                except (ValueError, TypeError, InvalidSignature, UnsupportedAlgorithm):
                    continue
            proposed = []
            for location in _extension(certificate, ExtensionOID.AUTHORITY_INFORMATION_ACCESS):
                if not isinstance(location.access_location, x509.UniformResourceIdentifier):
                    continue
                if location.access_method == AuthorityInformationAccessOID.CA_ISSUERS:
                    proposed.append(('certificates', location.access_location.value, b''))
                elif location.access_method == AuthorityInformationAccessOID.OCSP and issuer is not None:
                    # SHA1 is the OCSP CertID issuer identifier; all actual signature algorithms
                    # are independently constrained by the pinned validation policy.
                    request = ocsp.OCSPRequestBuilder().add_certificate(certificate, issuer, hashes.SHA1()).build()
                    proposed.append(('ocsps', location.access_location.value, request.public_bytes(serialization.Encoding.DER)))
            for point in _extension(certificate, ExtensionOID.CRL_DISTRIBUTION_POINTS):
                proposed.extend(('crls', location.value, b'') for location in (point.full_name or ())
                                if isinstance(location, x509.UniformResourceIdentifier))
            for kind, url, body in proposed:
                scanned += 1
                if scanned > 256 or len(targets) >= 12:
                    break
                try:
                    target = FetchTarget(kind, url, body)
                    network_policy.approve(target)
                    if target not in targets:
                        targets.append(target)
                except EgressError:
                    continue
        return tuple(targets)
    except (ValueError, TypeError, KeyError, UnsupportedAlgorithm):
        raise DiscoveryError() from None
