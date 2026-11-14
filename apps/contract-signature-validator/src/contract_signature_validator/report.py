"""Stable technical evidence; certificate subject/DOB/CPF are never serialized."""
from importlib.metadata import version
import json

from .model import PreflightReport, ValidationReport


def _engine():
    return {"validator": version("avila-contract-signature-validator"),
            "pyHanko": version("pyHanko"), "certvalidator": version("pyhanko-certvalidator")}


def _checks(checks):
    return [{"name": check.name, "verdict": check.verdict.value, "reason": check.reason,
             "evidenceHashes": list(check.evidence_hashes)}
            for check in sorted(checks, key=lambda c: c.name)]


def canonical_preflight_bytes(report: PreflightReport) -> bytes:
    binding, baseline = report.binding, report.baseline
    data = {
        "schemaVersion": "avila-contract-preflight/1",
        "binding": {
            "documentId": str(binding.document_id), "baseSha256": binding.base_sha256,
            "policySha256": binding.policy_sha256, "trustBundleSha256": binding.trust_bundle_sha256,
            "checkedAt": binding.checked_at.isoformat().replace("+00:00", "Z"),
        },
        "verdict": report.verdict.value, "trustProfile": report.trust_profile,
        "engine": _engine(), "checks": _checks(report.checks),
        "longTermValidation": "not_established",
        "baseline": None if baseline is None else {
            "documentId": str(baseline.document_id), "baseSha256": baseline.base_sha256,
            "baseSize": baseline.base_size, "policySha256": baseline.policy_sha256,
            "trustBundleSha256": baseline.trust_bundle_sha256,
            "signatures": [{"cmsSha256": item.cms_sha256,
                            "certificateSha256": item.certificate_sha256,
                            "fieldSha256": item.field_sha256} for item in baseline.signatures],
        },
    }
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def canonical_report_bytes(report: ValidationReport) -> bytes:
    binding = report.binding
    data = {
        "schemaVersion": "avila-contract-validation/1",
        "binding": {
            "documentId": str(binding.document_id),
            "participantId": str(binding.participant_id),
            "parentSha256": binding.parent_sha256,
            "candidateSha256": binding.candidate_sha256,
            "policySha256": binding.policy_sha256,
            "trustBundleSha256": binding.trust_bundle_sha256,
            "checkedAt": binding.checked_at.isoformat().replace("+00:00", "Z"),
        },
        "verdict": report.verdict.value,
        "trustProfile": report.trust_profile,
        "engine": _engine(),
        "checks": _checks(report.checks),
        "timestampStatus": report.timestamp_status,
        "longTermValidation": "not_established",
    }
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
