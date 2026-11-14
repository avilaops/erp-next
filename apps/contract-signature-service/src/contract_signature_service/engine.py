"""Isolated offline orchestration. Caller identity/time/config are bound before parsing."""
from dataclasses import dataclass, field
import hashlib

from contract_signature_validator.model import (CheckResult, EvidenceSet, PreflightBinding,
    ValidationBinding, ValidationReport, Verdict)
from contract_signature_validator.transport_response import encode_response
from contract_signature_validator.validation import preflight, validate_increment

from .config import ServiceConfig
from .discovery import discover_targets, embedded_evidence, normalize_evidence
from .egress import FetchTarget


class EngineError(ValueError):
    def __init__(self):
        super().__init__('validation_configuration_mismatch')


@dataclass(frozen=True)
class EngineResult:
    response: bytes = field(repr=False)
    evidence: EvidenceSet = field(repr=False)
    targets: tuple[FetchTarget, ...] = field(repr=False)
    terminal: bool


def _digest(value):
    return hashlib.sha256(value).hexdigest()


def run_engine(stage, authenticated, evidence, config):
    request = authenticated.request
    if (stage not in ('discover', 'validate') or not isinstance(config, ServiceConfig)
        or not isinstance(evidence, EvidenceSet) or evidence.observed_at != authenticated.observed_at
        or request.policy_sha256 != config.policy.sha256 or request.trust_bundle_sha256 != config.trust.sha256):
        raise EngineError()
    evidence = normalize_evidence(evidence)
    opened = preflight(request.base, PreflightBinding(request.document_id, _digest(request.base),
        config.policy.sha256, config.trust.sha256, authenticated.observed_at), config.policy, config.trust, evidence)
    personal = ()
    if request.operation == 'preflight':
        report = opened
        if opened.verdict == Verdict.ACCEPTED:
            evidence, _ = embedded_evidence(request.base, len(opened.baseline.signatures), evidence, config.policy, base=True)
    else:
        binding = ValidationBinding(request.document_id, request.signer.participant_id,
            _digest(request.parent), _digest(request.candidate), config.policy.sha256,
            config.trust.sha256, authenticated.observed_at)
        if opened.verdict != Verdict.ACCEPTED:
            timestamp = 'unsupported' if any(check.reason == 'timestamp_policy_unsupported'
                                             for check in opened.checks) else 'absent'
            report = ValidationReport(binding, (*opened.checks,
                CheckResult('validation', opened.verdict, 'base_preflight_failed')), config.trust.profile, timestamp)
        else:
            # If parsing is incompatible, let the core return its own invalid/unsupported
            # report; do not turn an unhandled service failure into mathematical acceptance.
            from pyhanko.pdf_utils.misc import PdfReadError
            from contract_signature_validator.pdf_policy import PdfPolicyError
            try:
                evidence, personal = embedded_evidence(request.candidate, len(opened.baseline.signatures),
                                                       evidence, config.policy)
            except (PdfReadError, PdfPolicyError, ValueError, TypeError, KeyError):
                personal = ()
            report = validate_increment(request.parent, request.candidate, binding, request.signer,
                request.previous_signers, opened.baseline, config.policy, config.trust, evidence)
    response = encode_response(authenticated, report, trust_profile=config.trust.profile)
    targets = ()
    terminal = request.operation == 'preflight' or stage == 'validate' or report.verdict != Verdict.INDETERMINATE
    if not terminal:
        targets = discover_targets(personal, evidence, config.trust, config.network_policy)
        terminal = not targets
    return EngineResult(response, evidence, targets, terminal)
