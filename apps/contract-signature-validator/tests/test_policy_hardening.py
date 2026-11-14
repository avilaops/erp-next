"""Functional regressions from the independent whole-branch review."""
import unittest

from asn1crypto import algos
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, padding
from pyhanko.sign import fields

from contract_signature_validator.model import Verdict
from fixtures import CPF, certificate, der, personal_fixture, resign_cms, sign_pdf, test_key, unsigned_pdf, with_price_metadata
import test_validation as original


class ReviewedPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        original.PdfValidationTests.setUpClass()

    def setUp(self):
        self.validator = original.PdfValidationTests()

    def test_effective_signature_hash_and_pss_mgf_cannot_bypass_content_digest_policy(self):
        key = self.validator.chain.leaf_key
        cases = [
            (algos.SignedDigestAlgorithm({'algorithm': 'sha1_rsa'}),
             lambda data: key.sign(data, padding.PKCS1v15(), hashes.SHA1())),
            (algos.SignedDigestAlgorithm({'algorithm': 'rsassa_pss', 'parameters': algos.RSASSAPSSParams.load(b'\x30\x00')}),
             lambda data: key.sign(data, padding.PSS(mgf=padding.MGF1(hashes.SHA1()), salt_length=20), hashes.SHA1())),
        ]
        for signature_hash, mgf_hash in ((hashes.SHA1(), hashes.SHA1()), (hashes.SHA256(), hashes.SHA1())):
            algorithm = algos.SignedDigestAlgorithm({'algorithm': 'rsassa_pss', 'parameters': {
                'hash_algorithm': {'algorithm': signature_hash.name},
                'mask_gen_algorithm': {'algorithm': 'mgf1', 'parameters': {'algorithm': mgf_hash.name}},
                'salt_length': signature_hash.digest_size}})
            cases.append((algorithm, lambda data, h=signature_hash, mgf=mgf_hash: key.sign(
                data, padding.PSS(mgf=padding.MGF1(mgf), salt_length=h.digest_size), h)))
        candidate = self.validator.signed()
        for algorithm, sign in cases:
            with self.subTest(algorithm=algorithm.native):
                report = self.validator.validate(resign_cms(candidate, algorithm, sign))
                self.assertEqual(report.verdict, Verdict.UNSUPPORTED, report)

    def test_ecdsa_weak_hash_is_rejected(self):
        chain = self.validator.chain
        cert, key = personal_fixture(chain, CPF, 900, key=ec.generate_private_key(ec.SECP256R1()))
        candidate = sign_pdf(self.validator.base, der(cert), key, 'EC', issuer=chain.intermediate, root=chain.root)
        algorithm = algos.SignedDigestAlgorithm({'algorithm': 'sha1_ecdsa'})
        report = self.validator.validate(resign_cms(candidate, algorithm, lambda data: key.sign(data, ec.ECDSA(hashes.SHA1()))))
        self.assertEqual(report.verdict, Verdict.UNSUPPORTED, report)

    def test_mismatched_certificate_family_is_rejected_without_crashing(self):
        chain = self.validator.chain
        wrong_family = resign_cms(self.validator.signed(), algos.SignedDigestAlgorithm({'algorithm': 'sha256_ecdsa'}),
                                 lambda data: chain.leaf_key.sign(data, padding.PKCS1v15(), hashes.SHA256()))
        self.assertEqual(self.validator.validate(wrong_family).verdict, Verdict.INVALID)

    def test_mandatory_seed_digest_is_checked_for_personal_signatures(self):
        bad = fields.SigSeedValueSpec(flags=fields.SigSeedValFlags.DIGEST_METHOD, digest_methods=['sha512'])
        candidate = self.validator.signed(seed=bad, ignore_seed=True)
        self.assertEqual(self.validator.validate(candidate).verdict, Verdict.INVALID)

    def test_mandatory_seed_digest_is_checked_for_technical_signatures(self):
        bad = fields.SigSeedValueSpec(flags=fields.SigSeedValFlags.DIGEST_METHOD, digest_methods=['sha512'])
        seal = certificate(policy='2.16.76.1.2.202.999999', attributes=[])
        base = sign_pdf(unsigned_pdf(), seal, test_key(), 'Technical', seed=bad, ignore_seed=True)
        self.assertEqual(self.validator.open(base).verdict, Verdict.INVALID)

    def test_supported_seed_digest_remains_accepted(self):
        good = fields.SigSeedValueSpec(flags=fields.SigSeedValFlags.DIGEST_METHOD, digest_methods=['sha256'])
        self.assertEqual(self.validator.validate(self.validator.signed(seed=good)).verdict, Verdict.ACCEPTED)

    def test_seed_timestamp_requirement_is_not_ignored(self):
        timestamp = fields.SigSeedValueSpec(timestamp_required=True, timestamp_server_url='https://timestamp.invalid')
        self.assertEqual(self.validator.validate(self.validator.signed(seed=timestamp, ignore_seed=True)).verdict, Verdict.INVALID)

    def test_unverifiable_mandatory_appearance_is_not_ignored(self):
        appearance = fields.SigSeedValueSpec(flags=fields.SigSeedValFlags.APPEARANCE_FILTER, appearance='unverifiable')
        self.assertEqual(self.validator.validate(self.validator.signed(seed=appearance, ignore_seed=True)).verdict, Verdict.UNSUPPORTED)

    def test_frozen_xmp_price_cannot_change_in_an_appended_revision(self):
        seal = certificate(policy='2.16.76.1.2.202.999999', attributes=[])
        self.validator.base = sign_pdf(with_price_metadata(unsigned_pdf(), '100.00'), seal, test_key(), 'Technical')
        self.assertEqual(self.validator.open().verdict, Verdict.ACCEPTED)
        changed = with_price_metadata(self.validator.base, '999999.00')
        candidate = self.validator.signed(changed)
        self.assertTrue(candidate.startswith(self.validator.base))
        self.assertEqual(self.validator.validate(candidate).verdict, Verdict.INVALID)
        unchanged = self.validator.signed(update_metadata=False)
        self.assertEqual(self.validator.validate(unchanged).verdict, Verdict.ACCEPTED)
        bookkeeping = self.validator.signed()
        self.assertEqual(self.validator.validate(bookkeeping).verdict, Verdict.ACCEPTED)

    def test_metadata_stream_dictionary_properties_are_frozen_too(self):
        seal = certificate(policy='2.16.76.1.2.202.999999', attributes=[])
        self.validator.base = sign_pdf(with_price_metadata(unsigned_pdf(), '100.00', header_price='100.00'),
                                       seal, test_key(), 'Technical', update_metadata=False)
        changed = with_price_metadata(self.validator.base, '100.00', header_price='999999.00')
        candidate = self.validator.signed(changed, update_metadata=False)
        self.assertTrue(candidate.startswith(self.validator.base))
        self.assertEqual(self.validator.validate(candidate).verdict, Verdict.INVALID)
