"""Immutable inputs and fail-closed results. No PDF, network or signing code."""
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
import hashlib
import json
import re
from uuid import UUID


class Verdict(str, Enum):
    ACCEPTED = "accepted"
    INVALID = "invalid"
    INDETERMINATE = "indeterminate"
    UNSUPPORTED = "unsupported"


def _hash(value: str) -> None:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError("invalid_sha256")


def _uuid(value: UUID) -> None:
    if not isinstance(value, UUID) or not value.int:
        raise ValueError("invalid_identifier")


def _utc(value: datetime) -> None:
    if not isinstance(value, datetime) or value.utcoffset() != timedelta(0):
        raise ValueError("invalid_checked_at")


def valid_cpf(value: str) -> bool:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{11}", value):
        return False
    if len(set(value)) == 1:
        return False
    for size in (9, 10):
        check = (sum(int(value[i]) * (size + 1 - i) for i in range(size)) * 10) % 11
        if int(value[size]) != (0 if check == 10 else check):
            return False
    return True


@dataclass(frozen=True)
class ValidationBinding:
    document_id: UUID
    participant_id: UUID
    parent_sha256: str
    candidate_sha256: str
    policy_sha256: str
    trust_bundle_sha256: str
    checked_at: datetime

    def __post_init__(self):
        _uuid(self.document_id)
        _uuid(self.participant_id)
        for value in (self.parent_sha256, self.candidate_sha256,
                      self.policy_sha256, self.trust_bundle_sha256):
            _hash(value)
        _utc(self.checked_at)


@dataclass(frozen=True)
class ExpectedSigner:
    participant_id: UUID
    expected_cpf: str = field(repr=False)

    def __post_init__(self):
        _uuid(self.participant_id)
        if not valid_cpf(self.expected_cpf):
            raise ValueError("invalid_cpf")

    @property
    def masked_cpf(self) -> str:
        return "***.***.***-" + self.expected_cpf[-2:]


@dataclass(frozen=True)
class CertificateIdentity:
    kind: str
    verdict: Verdict
    reason: str
    cpf: str | None = field(default=None, repr=False)

    def __post_init__(self):
        if self.kind not in {"e_cpf", "e_cnpj", "technical", "unknown"}:
            raise ValueError("invalid_certificate_kind")
        if not isinstance(self.verdict, Verdict):
            raise ValueError("invalid_verdict")
        if self.cpf is not None and (self.verdict != Verdict.ACCEPTED or not valid_cpf(self.cpf)):
            raise ValueError("invalid_identity")


@dataclass(frozen=True)
class ValidationPolicy:
    version: str = "contract-icp/1"
    certificate_requirement: str = "e_cpf"
    base_max_bytes: int = 20 * 1024 * 1024
    candidate_max_bytes: int = 32 * 1024 * 1024
    allowed_hashes: tuple[str, ...] = ("sha256", "sha384", "sha512")
    allowed_signatures: tuple[str, ...] = ("rsassa_pkcs1v15", "rsassa_pss", "ecdsa")
    allowed_curves: tuple[str, ...] = ("secp256r1", "secp384r1", "secp521r1")
    min_rsa_bits: int = 2048

    def __post_init__(self):
        if self.version != "contract-icp/1" or self.certificate_requirement != "e_cpf":
            raise ValueError("unsupported_policy")
        for value, ceiling in ((self.base_max_bytes, 20 * 1024 * 1024),
                               (self.candidate_max_bytes, 32 * 1024 * 1024)):
            if type(value) is not int or not 0 < value <= ceiling:
                raise ValueError("unsupported_byte_limit")
        if self.base_max_bytes > self.candidate_max_bytes:
            raise ValueError("inconsistent_byte_limits")
        for values, supported in (
            (self.allowed_hashes, {"sha256", "sha384", "sha512"}),
            (self.allowed_signatures, {"rsassa_pkcs1v15", "rsassa_pss", "ecdsa"}),
            (self.allowed_curves, {"secp256r1", "secp384r1", "secp521r1"}),
        ):
            if not isinstance(values, tuple) or not values or len(set(values)) != len(values) or not set(values) <= supported:
                raise ValueError("unsupported_algorithm_policy")
        if type(self.min_rsa_bits) is not int or self.min_rsa_bits < 2048:
            raise ValueError("unsupported_rsa_policy")

    @property
    def sha256(self) -> str:
        return hashlib.sha256(json.dumps(self.__dict__, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@dataclass(frozen=True)
class CheckResult:
    name: str
    verdict: Verdict
    reason: str
    evidence_hashes: tuple[str, ...] = ()

    def __post_init__(self):
        if not isinstance(self.verdict, Verdict):
            raise ValueError("invalid_verdict")
        for code in (self.name, self.reason):
            if not isinstance(code, str) or not re.fullmatch(r"[a-z_]{1,80}", code):
                raise ValueError("invalid_check_code")
        if not isinstance(self.evidence_hashes, tuple):
            raise ValueError("invalid_evidence_manifest")
        for value in self.evidence_hashes:
            _hash(value)


REQUIRED_INCREMENT_CHECKS = frozenset({
    "binding", "increment", "baseline", "identity", "chain", "revocation",
    "prior_signatures", "modifications", "coverage", "algorithms",
})


@dataclass(frozen=True)
class ValidationReport:
    binding: ValidationBinding
    checks: tuple[CheckResult, ...]
    trust_profile: str

    def __post_init__(self):
        if not isinstance(self.binding, ValidationBinding) or not isinstance(self.checks, tuple):
            raise ValueError("invalid_report")
        if any(not isinstance(check, CheckResult) for check in self.checks):
            raise ValueError("invalid_report_checks")
        if len({check.name for check in self.checks}) != len(self.checks):
            raise ValueError("duplicate_report_check")
        if self.trust_profile not in {"icp_brasil", "synthetic_not_icp"}:
            raise ValueError("invalid_trust_profile")

    @property
    def verdict(self) -> Verdict:
        states = {check.verdict for check in self.checks}
        if Verdict.INVALID in states:
            return Verdict.INVALID
        if Verdict.UNSUPPORTED in states:
            return Verdict.UNSUPPORTED
        if Verdict.INDETERMINATE in states or not REQUIRED_INCREMENT_CHECKS <= {c.name for c in self.checks}:
            return Verdict.INDETERMINATE
        return Verdict.ACCEPTED

    @property
    def sha256(self) -> str:
        from .report import canonical_report_bytes
        return hashlib.sha256(canonical_report_bytes(self)).hexdigest()
