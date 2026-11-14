"""Public validation workflow; no signing, fetching or mutable document state."""
from dataclasses import replace
import hmac

from pyhanko.pdf_utils.misc import PdfReadError

from .evidence import verify_certificate
from .identity import extract_personal_identity
from .model import BaselineInventory, CheckResult, PreflightReport, ValidationReport, Verdict
from .pdf_policy import (PdfPolicyError, assert_frozen_fields, check_increment, check_signatures,
                         open_pdf, sha256, signature_inventory)


def _check(name, verdict=Verdict.ACCEPTED, reason="validated", hashes=()):
    return CheckResult(name, verdict, reason, hashes)


def preflight(base, binding, policy, trust, evidence):
    checks = []
    try:
        if (binding.base_sha256 != sha256(base) or binding.policy_sha256 != policy.sha256
            or binding.trust_bundle_sha256 != trust.sha256 or binding.checked_at != evidence.observed_at):
            raise PdfPolicyError("binding_mismatch")
        checks.append(_check("binding"))
        reader = open_pdf(base, policy, base=True)
        checks.append(_check("format"))
        signatures = check_signatures(reader, policy)
        if any(sig.docmdp_level is not None and sig.docmdp_level.value < 2 for sig in signatures):
            raise PdfPolicyError("certification_prevents_signing", Verdict.UNSUPPORTED)
        inventory = signature_inventory(signatures)
        checks.append(_check("baseline"))
        baseline = BaselineInventory(binding.document_id, binding.base_sha256, len(base),
            policy.sha256, trust.sha256, inventory)
        return PreflightReport(binding, tuple(checks), trust.profile, baseline)
    except PdfPolicyError as error:
        checks.append(_check("preflight", error.verdict, error.reason))
    except (PdfReadError, ValueError, TypeError, KeyError):
        checks.append(_check("preflight", Verdict.INVALID, "malformed_pdf"))
    return PreflightReport(binding, tuple(checks), trust.profile)


def _embedded_evidence(evidence, signatures):
    certs = set(evidence.certificates)
    for sig in signatures:
        for choice in sig.signed_data["certificates"]:
            if choice.name == "certificate":
                certs.add(choice.chosen.dump())
    return replace(evidence, certificates=tuple(sorted(certs)))


def validate_increment(parent, candidate, binding, signer, previous_signers, baseline, policy, trust, evidence):
    checks = []
    timestamp_status = "absent"
    try:
        if (not isinstance(baseline, BaselineInventory) or binding.document_id != baseline.document_id
            or binding.participant_id != signer.participant_id or binding.parent_sha256 != sha256(parent)
            or binding.candidate_sha256 != sha256(candidate) or binding.policy_sha256 != policy.sha256
            or baseline.policy_sha256 != policy.sha256 or binding.trust_bundle_sha256 != trust.sha256
            or baseline.trust_bundle_sha256 != trust.sha256 or binding.checked_at != evidence.observed_at
            or baseline.base_size > len(parent) or sha256(parent[:baseline.base_size]) != baseline.base_sha256):
            raise PdfPolicyError("binding_mismatch")
        people = (*previous_signers, signer)
        if len({p.participant_id for p in people}) != len(people):
            raise PdfPolicyError("participant_sequence_invalid")
        if len({p.expected_cpf for p in people}) != len(people):
            raise PdfPolicyError("duplicate_identity_policy_unsupported", Verdict.UNSUPPORTED)
        checks.append(_check("binding"))
        if not candidate.startswith(parent) or len(candidate) <= len(parent):
            raise PdfPolicyError("parent_prefix_modified")
        original = open_pdf(parent, policy)
        updated = open_pdf(candidate, policy)
        old_signatures = check_signatures(original, policy)
        new_signatures = check_signatures(updated, policy)
        if len(old_signatures) != len(baseline.signatures)+len(previous_signers) or len(new_signatures) != len(old_signatures)+1:
            raise PdfPolicyError("signature_sequence_invalid")
        checks.append(_check("increment"))
        old_inventory, new_inventory = signature_inventory(old_signatures), signature_inventory(new_signatures)
        if old_inventory[:len(baseline.signatures)] != baseline.signatures or new_inventory[:-1] != old_inventory:
            raise PdfPolicyError("prior_signature_modified")
        checks.append(_check("baseline"))
        assert_frozen_fields(original, updated, new_signatures[-1])
        check_increment(original, updated)
        checks.extend((_check("modifications"), _check("coverage"), _check("algorithms")))
        if any(sig.docmdp_level is not None for sig in new_signatures[len(old_signatures):]):
            raise PdfPolicyError("new_certification_unsupported", Verdict.UNSUPPORTED)
        technical_certs = {item.certificate_sha256 for item in baseline.signatures}
        personal = new_signatures[len(baseline.signatures):]
        for sig, expected in zip(personal, people, strict=True):
            identity = extract_personal_identity(sig.signer_cert.dump())
            if identity.verdict != Verdict.ACCEPTED or sha256(sig.signer_cert.dump()) in technical_certs:
                reason = identity.reason if identity.verdict != Verdict.ACCEPTED else "personal_certificate_required"
                raise PdfPolicyError(reason, identity.verdict if identity.verdict != Verdict.ACCEPTED else Verdict.INVALID)
            if not hmac.compare_digest(identity.cpf, expected.expected_cpf):
                raise PdfPolicyError("cpf_mismatch")
        checks.append(_check("identity"))
        complete_evidence = _embedded_evidence(evidence, new_signatures)
        for sig in personal[:-1]:
            prior = verify_certificate(sig.signer_cert.dump(), trust, complete_evidence, binding.checked_at)
            if any(item.verdict != Verdict.ACCEPTED for item in prior):
                state = Verdict.INVALID if any(item.verdict == Verdict.INVALID for item in prior) else Verdict.INDETERMINATE
                raise PdfPolicyError("prior_certificate_not_validated", state)
        checks.append(_check("prior_signatures"))
        checks.extend(verify_certificate(personal[-1].signer_cert.dump(), trust, complete_evidence, binding.checked_at))
    except PdfPolicyError as error:
        timestamp_status = "unsupported" if error.timestamp else "absent"
        checks.append(_check("validation", error.verdict, error.reason))
    except (PdfReadError, ValueError, TypeError, KeyError):
        checks.append(_check("validation", Verdict.INVALID, "malformed_pdf"))
    return ValidationReport(binding, tuple(checks), trust.profile, timestamp_status)
