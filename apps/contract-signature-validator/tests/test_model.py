import unittest
from dataclasses import FrozenInstanceError, replace
from datetime import timedelta, timezone

from contract_signature_validator.model import ExpectedSigner, ValidationBinding, ValidationPolicy
from fixtures import CPF, NOW, PARTICIPANT, binding_values


class ModelTests(unittest.TestCase):
    def test_binding_is_frozen_and_requires_exact_hashes_identifiers_and_utc(self):
        value = ValidationBinding(**binding_values())
        with self.assertRaises(FrozenInstanceError):
            value.parent_sha256 = "e" * 64
        for changes in [
            {"parent_sha256": "A" * 64}, {"candidate_sha256": "a" * 63},
            {"policy_sha256": "z" * 64}, {"document_id": str(value.document_id)},
            {"checked_at": NOW.replace(tzinfo=None)},
            {"checked_at": NOW.astimezone(timezone(timedelta(hours=3)))},
        ]:
            with self.subTest(changes=tuple(changes)), self.assertRaises(ValueError):
                replace(value, **changes)

    def test_expected_signer_hides_full_cpf_and_validates_check_digits(self):
        value = ExpectedSigner(PARTICIPANT, CPF)
        self.assertNotIn(CPF, repr(value))
        self.assertEqual(value.masked_cpf, "***.***.***-25")
        self.assertEqual(ExpectedSigner(PARTICIPANT, "01234567890").expected_cpf, "01234567890")
        for invalid in ["11111111111", "52998224724", "529.982.247-25", "٥٢٩٩٨٢٢٤٧٢٥"]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                ExpectedSigner(PARTICIPANT, invalid)

    def test_policy_hash_covers_limits_and_cannot_downgrade_personal_requirement(self):
        value = ValidationPolicy()
        self.assertEqual(len(value.sha256), 64)
        self.assertEqual(value.sha256, ValidationPolicy().sha256)
        self.assertNotEqual(value.sha256, replace(value, base_max_bytes=1024 * 1024).sha256)
        with self.assertRaises(ValueError):
            replace(value, certificate_requirement="portal_seal")
        with self.assertRaises(ValueError):
            replace(value, candidate_max_bytes=33 * 1024 * 1024)
