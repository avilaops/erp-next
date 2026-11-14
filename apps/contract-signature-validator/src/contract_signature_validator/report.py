"""Stable technical evidence; certificate subject/DOB/CPF are never serialized."""
from importlib.metadata import version
import json

from .model import ValidationReport


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
        "engine": {"validator": version("avila-contract-signature-validator"),
                   "pyHanko": version("pyHanko"), "certvalidator": version("pyhanko-certvalidator")},
        "checks": [
            {"name": check.name, "verdict": check.verdict.value, "reason": check.reason,
             "evidenceHashes": list(check.evidence_hashes)}
            for check in sorted(report.checks, key=lambda c: c.name)
        ],
        "timestampStatus": report.timestamp_status,
        "longTermValidation": "not_established",
    }
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
