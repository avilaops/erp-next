import hashlib
import json
import unittest

from contract_signature_validator.model import CheckResult, ValidationBinding, ValidationReport, Verdict
from contract_signature_validator.report import canonical_report_bytes
from fixtures import CPF, binding_values

REQUIRED = ("binding", "increment", "baseline", "identity", "chain", "revocation",
            "prior_signatures", "modifications", "coverage", "algorithms")


class ReportTests(unittest.TestCase):
    def report(self, checks):
        return ValidationReport(ValidationBinding(**binding_values()), tuple(checks), "synthetic_not_icp")

    def test_absent_checks_never_mean_accepted_and_hard_failure_wins(self):
        self.assertEqual(self.report([]).verdict, Verdict.INDETERMINATE)
        complete = [CheckResult(name, Verdict.ACCEPTED, "validated") for name in REQUIRED]
        self.assertEqual(self.report(complete).verdict, Verdict.ACCEPTED)
        for missing in REQUIRED:
            self.assertEqual(self.report([c for c in complete if c.name != missing]).verdict, Verdict.INDETERMINATE)
        complete[3] = CheckResult("identity", Verdict.INVALID, "cpf_mismatch")
        self.assertEqual(self.report(complete).verdict, Verdict.INVALID)

    def test_canonical_report_binds_hashes_without_claiming_timestamp_or_icp_test_trust(self):
        value = self.report([CheckResult(name, Verdict.ACCEPTED, "validated") for name in REQUIRED])
        encoded = canonical_report_bytes(value)
        self.assertEqual(encoded, canonical_report_bytes(value))
        self.assertNotIn(CPF.encode(), encoded)
        result = json.loads(encoded)
        self.assertEqual(result["trustProfile"], "synthetic_not_icp")
        self.assertEqual(result["binding"]["parentSha256"], "a" * 64)
        self.assertEqual(result["timestampStatus"], "absent")
        self.assertEqual(result["longTermValidation"], "not_established")
        self.assertEqual(value.sha256, hashlib.sha256(encoded).hexdigest())
