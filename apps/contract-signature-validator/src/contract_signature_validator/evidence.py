"""Strict offline PKIX/revocation validation. No fetching, signing or cached verdicts."""
import asyncio
from datetime import datetime
import hashlib

from asn1crypto import crl, ocsp, x509
from pyhanko_certvalidator import CertificateValidator, ValidationContext, errors
from pyhanko_certvalidator.policy_decl import CertRevTrustPolicy, RevocationCheckingPolicy, RevocationCheckingRule

from .model import CheckResult, EvidenceSet, Verdict, _utc
from .trust import TrustBundle


def _covers(this_update, next_update, moment):
    return this_update is not None and next_update is not None and this_update <= moment <= next_update


def validation_context(trust: TrustBundle, evidence: EvidenceSet, checked_at: datetime) -> ValidationContext:
    _utc(checked_at)
    if evidence.observed_at != checked_at:
        raise ValueError("evidence_observation_mismatch")
    parsed_crls = [crl.CertificateList.load(value, strict=True) for value in evidence.crls]
    fresh_crls = [value for value in parsed_crls if _covers(
        value["tbs_cert_list"]["this_update"].native,
        value["tbs_cert_list"]["next_update"].native, checked_at)]
    fresh_ocsps = []
    for raw in evidence.ocsps:
        response = ocsp.OCSPResponse.load(raw, strict=True)
        if response["response_status"].native != "successful":
            continue
        data = response["response_bytes"]["response"].parsed["tbs_response_data"]
        responses = data["responses"]
        if responses and data["produced_at"].native <= checked_at and all(_covers(
            item["this_update"].native, item["next_update"].native, checked_at
        ) for item in responses):
            fresh_ocsps.append(response)
    strict = RevocationCheckingRule.CRL_OR_OCSP_REQUIRED
    return ValidationContext(
        trust_roots=trust.roots,
        other_certs=(*trust.intermediates, *(x509.Certificate.load(value, strict=True) for value in evidence.certificates)),
        moment=checked_at, allow_fetching=False,
        crls=fresh_crls, ocsps=fresh_ocsps,
        revinfo_policy=CertRevTrustPolicy(RevocationCheckingPolicy(strict, strict)),
    )


def _checks(chain_state, revocation_state, reason, evidence):
    cert_hashes = tuple(sorted({hashlib.sha256(c).hexdigest() for c in evidence.certificates}))
    rev_hashes = tuple(sorted({hashlib.sha256(c).hexdigest() for c in (*evidence.crls, *evidence.ocsps)}))
    return (CheckResult("chain", chain_state, reason, cert_hashes),
            CheckResult("revocation", revocation_state, reason, rev_hashes))


def verify_certificate(cert_der: bytes, trust: TrustBundle, evidence: EvidenceSet,
                       checked_at: datetime) -> tuple[CheckResult, ...]:
    _utc(checked_at)
    if evidence.observed_at != checked_at:
        raise ValueError("evidence_observation_mismatch")
    if not isinstance(cert_der, bytes) or not 0 < len(cert_der) <= 256 * 1024:
        return _checks(Verdict.INVALID, Verdict.INDETERMINATE, "malformed_certificate", evidence)
    try:
        context = validation_context(trust, evidence, checked_at)
        cert = x509.Certificate.load(cert_der, strict=True)
        validator = CertificateValidator(cert, validation_context=context)
        asyncio.run(validator.async_validate_usage({"digital_signature"}))
        return _checks(Verdict.ACCEPTED, Verdict.ACCEPTED, "chain_and_revocation_validated", evidence)
    except errors.RevokedError:
        return _checks(Verdict.INVALID, Verdict.INVALID, "certificate_revoked", evidence)
    except errors.StaleRevinfoError:
        return _checks(Verdict.INDETERMINATE, Verdict.INDETERMINATE, "revocation_stale", evidence)
    except errors.InsufficientRevinfoError as error:
        # certvalidator 0.33 flattens CRL/OCSP signature failures into this type.
        # Only classify a negative verdict here; no acceptance depends on text.
        bad_signature = any(value in error.failure_msg for value in (
            "CRL signature could not be verified", "Unable to verify OCSP response signature"))
        state = Verdict.INVALID if bad_signature else Verdict.INDETERMINATE
        reason = "revocation_signature_invalid" if bad_signature else "revocation_not_established"
        return _checks(state, state, reason, evidence)
    except errors.PathBuildingError:
        return _checks(Verdict.INDETERMINATE, Verdict.INDETERMINATE, "certificate_path_incomplete", evidence)
    except errors.ValidationError:
        return _checks(Verdict.INVALID, Verdict.INDETERMINATE, "certificate_path_invalid", evidence)
    except (ValueError, TypeError, KeyError):
        return _checks(Verdict.INVALID, Verdict.INVALID, "malformed_validation_material", evidence)
