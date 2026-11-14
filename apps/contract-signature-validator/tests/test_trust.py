import unittest
from dataclasses import replace
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import serialization

from contract_signature_validator.trust import load_trust_bundle
from fixtures import certificate, test_key

REPO = Path(__file__).resolve().parents[3]


class TrustTests(unittest.TestCase):
    def test_reviewed_public_roots_stay_distinct_from_untrusted_intermediates(self):
        roots = (REPO / "deploy/fiscal/icp-brasil-roots.pem").read_bytes()
        intermediates = (REPO / "deploy/fiscal/icp-brasil-intermediates.pem").read_bytes()
        value = load_trust_bundle(roots, intermediates)
        self.assertEqual(value.profile, "icp_brasil")
        self.assertEqual(len(value.roots), 8)
        self.assertGreater(len(value.intermediates), len(value.roots))
        self.assertNotEqual(value.sha256, load_trust_bundle(roots).sha256)

    def test_synthetic_ca_cannot_become_production_trust_by_claiming_a_purpose(self):
        pem = x509.load_der_x509_certificate(certificate(ca=True)).public_bytes(serialization.Encoding.PEM)
        with self.assertRaises(ValueError):
            load_trust_bundle(pem)
        value = load_trust_bundle(pem, allow_synthetic=True)
        self.assertEqual(value.profile, "synthetic_not_icp")
        with self.assertRaises(ValueError):
            replace(value, profile="icp_brasil")

    def test_bundle_accepts_only_certificate_pem_without_private_material_or_trailing_payload(self):
        roots = (REPO / "deploy/fiscal/icp-brasil-roots.pem").read_bytes()
        synthetic_key = test_key().private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        for suffix in (synthetic_key, b"arbitrary trailing bytes"):
            with self.subTest(kind="synthetic_key" if suffix is synthetic_key else "trailing"), self.assertRaises(ValueError):
                load_trust_bundle(roots + suffix)
