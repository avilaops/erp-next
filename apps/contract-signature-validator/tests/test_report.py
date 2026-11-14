import hashlib
import json
import unittest
from dataclasses import replace
from importlib.metadata import version

from contract_signature_validator.model import (BaselineInventory, CheckResult, PreflightBinding,
    PreflightReport, SignatureInventoryItem, ValidationBinding, ValidationReport, Verdict)
from contract_signature_validator.report import canonical_report_bytes
from fixtures import CPF, DOCUMENT, NOW, binding_values

REQUIRED = ("binding", "increment", "baseline", "identity", "chain", "revocation",
            "prior_signatures", "modifications", "coverage", "algorithms")


class ReportTests(unittest.TestCase):
    def preflight_report(self, checks=None, **overrides):
        binding = PreflightBinding(DOCUMENT, 'a' * 64, 'c' * 64, 'd' * 64, NOW)
        inventory = BaselineInventory(DOCUMENT, 'a' * 64, 100, 'c' * 64, 'd' * 64,
            (SignatureInventoryItem('private_' + CPF, 'e' * 64, 'f' * 64, '0' * 64),))
        values = dict(binding=binding, checks=tuple(checks if checks is not None else
            (CheckResult(name, Verdict.ACCEPTED, 'validated') for name in ('binding', 'format', 'baseline'))),
            trust_profile='synthetic_not_icp', baseline=inventory)
        return PreflightReport(**(values | overrides))

    def test_preflight_requires_an_explicit_trust_profile_and_complete_checks(self):
        self.assertIn('trust_profile', PreflightReport.__annotations__)
        result = self.preflight_report()
        self.assertEqual(result.trust_profile, 'synthetic_not_icp')
        self.assertEqual(result.verdict, Verdict.ACCEPTED)
        for missing in ('binding', 'format', 'baseline'):
            self.assertEqual(replace(result, checks=tuple(c for c in result.checks if c.name != missing)).verdict,
                             Verdict.INDETERMINATE)
        with self.assertRaises(ValueError):
            self.preflight_report(trust_profile='adobe_trusted')
        with self.assertRaises(ValueError):
            self.preflight_report(checks=(result.checks[0], result.checks[0]))
        with self.assertRaises(ValueError):
            self.preflight_report(baseline=replace(result.baseline, base_sha256='b' * 64))

    def test_preflight_canonical_inventory_is_reproducible_and_private(self):
        from contract_signature_validator import report as report_module
        self.assertTrue(callable(getattr(report_module, 'canonical_preflight_bytes', None)))
        from contract_signature_validator.report import canonical_preflight_bytes
        report = self.preflight_report()
        encoded = canonical_preflight_bytes(report)
        self.assertEqual(encoded, canonical_preflight_bytes(report))
        self.assertNotIn(CPF.encode(), encoded)
        self.assertNotIn(b'private_', encoded)
        decoded = json.loads(encoded)
        self.assertEqual(decoded['trustProfile'], 'synthetic_not_icp')
        self.assertEqual(decoded['schemaVersion'], 'avila-contract-preflight/1')
        self.assertEqual(decoded['baseline']['baseSha256'], 'a' * 64)
        self.assertEqual(decoded['baseline']['signatures'][0]['cmsSha256'], 'e' * 64)
        self.assertEqual(decoded['longTermValidation'], 'not_established')
        self.assertEqual(decoded['engine']['validator'], version('avila-contract-signature-validator'))
        failed = replace(report, baseline=None, checks=(CheckResult('preflight', Verdict.INVALID, 'malformed_pdf'),))
        self.assertEqual(json.loads(canonical_preflight_bytes(failed))['trustProfile'], 'synthetic_not_icp')
        self.assertIsNone(json.loads(canonical_preflight_bytes(failed))['baseline'])

    def test_report_identifies_the_installed_validator_version(self):
        encoded = canonical_report_bytes(self.report([]))
        self.assertEqual(json.loads(encoded)["engine"]["validator"], version("avila-contract-signature-validator"))

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
