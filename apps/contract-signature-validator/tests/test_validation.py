from dataclasses import replace
from io import StringIO
import hashlib
import logging
import unittest

from contract_signature_validator.model import EvidenceSet, ExpectedSigner, PreflightBinding, ValidationBinding, ValidationPolicy, Verdict
from contract_signature_validator.trust import load_trust_bundle
from contract_signature_validator.validation import preflight, validate_increment
from fixtures import CPF, DOCUMENT, NOW, PARTICIPANT, add_unsupported_timestamp, append_change, certificate, chain_fixture, der, issued_crl, pem, sealed_pdf, sign_pdf, test_key, unsigned_pdf


def digest(value):
    return hashlib.sha256(value).hexdigest()


class PdfValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.chain = chain_fixture()
        cls.trust = load_trust_bundle(pem(cls.chain.root), allow_synthetic=True)
        cls.policy = ValidationPolicy()
        cls.evidence = EvidenceSet(observed_at=NOW, certificates=(der(cls.chain.intermediate),), crls=(
            issued_crl(cls.chain.root, cls.chain.root_key), issued_crl(cls.chain.intermediate, cls.chain.intermediate_key)))
        cls.base = sealed_pdf()

    def open(self, base=None):
        base = self.base if base is None else base
        binding = PreflightBinding(DOCUMENT, digest(base), self.policy.sha256, self.trust.sha256, NOW)
        return preflight(base, binding, self.policy, self.trust, self.evidence)

    def signed(self, parent=None, field="PersonalSignature", **options):
        return sign_pdf(self.base if parent is None else parent, der(self.chain.leaf), self.chain.leaf_key, field,
                        issuer=self.chain.intermediate, root=self.chain.root, **options)

    def validate(self, candidate, *, parent=None, signer=None, binding=None, baseline=None, evidence=None, previous=()):
        parent = self.base if parent is None else parent
        signer = signer or ExpectedSigner(PARTICIPANT, CPF)
        binding = binding or ValidationBinding(DOCUMENT, signer.participant_id, digest(parent), digest(candidate), self.policy.sha256, self.trust.sha256, NOW)
        return validate_increment(parent, candidate, binding, signer, previous, baseline or self.open().baseline,
                                  self.policy, self.trust, evidence or self.evidence)

    def test_seal_is_preserved_and_a_personal_increment_is_validated(self):
        opened = self.open()
        self.assertEqual(opened.verdict, Verdict.ACCEPTED, opened)
        self.assertEqual(opened.baseline.base_sha256, digest(self.base))
        candidate = self.signed()
        self.assertTrue(candidate.startswith(self.base))
        report = self.validate(candidate, baseline=opened.baseline)
        self.assertEqual(report.verdict, Verdict.ACCEPTED, report)
        self.assertEqual(report.trust_profile, "synthetic_not_icp")

    def test_wrong_binding_hash_policy_or_document_is_rejected(self):
        candidate = self.signed()
        binding = ValidationBinding(DOCUMENT, PARTICIPANT, digest(self.base), digest(candidate), self.policy.sha256, self.trust.sha256, NOW)
        for changes in ({"parent_sha256": "a"*64}, {"candidate_sha256": "b"*64},
                        {"policy_sha256": "c"*64}, {"trust_bundle_sha256": "d"*64},
                        {"document_id": PARTICIPANT}):
            self.assertEqual(self.validate(candidate, binding=replace(binding, **changes)).verdict, Verdict.INVALID)

    def test_prefix_change_zero_or_two_new_signatures_are_rejected(self):
        changed = self.base.replace(b"SYNTHETIC CONTRACT", b"TYNTHETIC CONTRACT")
        self.assertNotEqual(changed, self.base)
        twice = self.signed(self.signed(), field="SecondPersonalSignature")
        for candidate in (self.base, self.signed(changed), twice):
            self.assertEqual(self.validate(candidate).verdict, Verdict.INVALID)

    def test_wrong_expected_cpf_cannot_be_replaced_by_the_uploaded_identity(self):
        report = self.validate(self.signed(), signer=ExpectedSigner(PARTICIPANT, "01234567890"))
        self.assertEqual(report.verdict, Verdict.INVALID)
        self.assertIn("cpf_mismatch", [check.reason for check in report.checks])

    def test_technical_seal_and_company_certificate_do_not_count_as_personal(self):
        from asn1crypto import core
        attrs = [("2.16.76.1.3.3", core.UTF8String("11222333000181").dump()),
                 ("2.16.76.1.3.4", core.UTF8String("01011990" + CPF + "0"*39).dump())]
        for cert in (certificate(policy="2.16.76.1.2.202.999999", attributes=[]), certificate(attributes=attrs)):
            candidate = sign_pdf(self.base, cert, test_key(), "NotAPersonalSigner")
            report = self.validate(candidate)
            self.assertEqual(report.verdict, Verdict.INVALID)
            self.assertIn("personal_certificate_required", [check.reason for check in report.checks])

    def test_prefix_preserving_changes_to_price_page_or_content_are_rejected(self):
        for kind in ("price", "page", "content", "resources", "remove_signature", "signature_contents", "signature_certificate"):
            with self.subTest(kind=kind):
                changed = append_change(self.base, kind)
                self.assertTrue(changed.startswith(self.base))
                self.assertEqual(self.validate(self.signed(changed)).verdict, Verdict.INVALID)

    def test_trailing_unsigned_bytes_and_truncated_pdf_cannot_pass(self):
        candidate = self.signed()
        for altered in (candidate + b"\n% unsigned trailing data\n", candidate[:-50]):
            self.assertEqual(self.validate(altered).verdict, Verdict.INVALID)

    def test_no_changes_certification_or_encryption_cannot_be_silently_removed(self):
        for base in (sealed_pdf(locked=True), unsigned_pdf(encrypted=True)):
            self.assertEqual(self.open(base).verdict, Verdict.UNSUPPORTED)

    def test_new_visible_signature_cannot_cover_existing_contract_text(self):
        self.assertNotEqual(self.validate(self.signed(visible=True)).verdict, Verdict.ACCEPTED)

    def test_locked_commercial_field_does_not_become_editable_during_signing(self):
        base = sealed_pdf(lock_price=True)
        opened = self.open(base)
        self.assertEqual(opened.verdict, Verdict.ACCEPTED)
        candidate = self.signed(append_change(base, "price"))
        self.assertEqual(self.validate(candidate, parent=base, baseline=opened.baseline).verdict, Verdict.INVALID)

    def test_field_locks_cannot_be_removed_in_an_increment(self):
        base = sealed_pdf(lock_price=True)
        candidate = self.signed(append_change(base, "remove_locks"))
        self.assertEqual(self.validate(candidate, parent=base, baseline=self.open(base).baseline).verdict, Verdict.INVALID)

    def test_size_limits_are_checked_before_the_pdf_parser(self):
        policy = replace(self.policy, base_max_bytes=32, candidate_max_bytes=64)
        binding = PreflightBinding(DOCUMENT, digest(self.base), policy.sha256, self.trust.sha256, NOW)
        self.assertEqual(preflight(self.base, binding, policy, self.trust, self.evidence).verdict, Verdict.UNSUPPORTED)

    def test_missing_revocation_stays_indeterminate_and_parser_logs_do_not_expose_cpf(self):
        stream = StringIO()
        handler = logging.StreamHandler(stream)
        logger = logging.getLogger("pyhanko")
        logger.addHandler(handler)
        try:
            report = self.validate(self.signed(), evidence=EvidenceSet(observed_at=NOW))
        finally:
            logger.removeHandler(handler)
        self.assertEqual(report.verdict, Verdict.INDETERMINATE)
        self.assertNotIn(CPF, repr(report))
        self.assertNotIn(CPF, stream.getvalue())

    def test_account_seal_certificate_cannot_be_reused_as_a_personal_participant(self):
        base = sign_pdf(unsigned_pdf(), der(self.chain.leaf), self.chain.leaf_key, "DocuSealAccount",
                        issuer=self.chain.intermediate, root=self.chain.root)
        opened = self.open(base)
        candidate = self.signed(base)
        report = self.validate(candidate, parent=base, baseline=opened.baseline)
        self.assertEqual(report.verdict, Verdict.INVALID)
        self.assertIn("personal_certificate_required", [check.reason for check in report.checks])

    def test_timestamp_without_supported_trust_policy_is_reported_as_unsupported(self):
        report = self.validate(add_unsupported_timestamp(self.signed()))
        self.assertEqual(report.verdict, Verdict.UNSUPPORTED)
        self.assertEqual(report.timestamp_status, "unsupported")
