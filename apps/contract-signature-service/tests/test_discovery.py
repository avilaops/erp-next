from dataclasses import replace
import unittest

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.serialization import pkcs7
from cryptography.x509 import ocsp
from helpers import load, validation_fixture
from contract_signature_validator.model import EvidenceSet
from fixtures import NOW, chain_fixture, der, issued_crl, pem


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.api = load(self, 'discovery')
        self.egress = load(self, 'egress')
        self.chain = chain_fixture()
        self.auth, self.ctx, self.report, self.evidence, self.trust = validation_fixture()
        self.rules = self.egress.NetworkPolicy({'http://revocation.invalid': ('/',),
                                                'http://ocsp.invalid': ('/',)})

    def test_only_reachable_chain_endpoints_are_returned_once(self):
        targets = self.api.discover_targets((der(self.chain.leaf),), self.evidence, self.trust, self.rules)
        crls = [target.url for target in targets if target.kind == 'crls']
        self.assertEqual(set(crls), {'http://revocation.invalid/leaf.crl', 'http://revocation.invalid/root.crl'})
        self.assertEqual(len(crls), 2)
        for target in targets:
            self.rules.approve(target)
        blocked = self.egress.NetworkPolicy({'https://other.invalid': ('/',)})
        self.assertEqual(self.api.discover_targets((der(self.chain.leaf),), self.evidence, self.trust, blocked), ())

    def test_ocsp_certid_binds_the_real_issuer_and_serial_not_the_expected_cpf(self):
        targets = self.api.discover_targets((der(self.chain.leaf),), self.evidence, self.trust, self.rules)
        requests = [target for target in targets if target.kind == 'ocsps']
        self.assertTrue(requests)
        decoded = ocsp.load_der_ocsp_request(requests[0].body)
        self.assertEqual(decoded.serial_number, self.chain.leaf.serial_number)
        self.assertEqual(decoded.hash_algorithm.name, 'sha1')  # Identifier hash, never a signature downgrade.
        self.assertNotIn('52998224725', repr(requests[0]))

    def test_der_pem_and_pkcs7_issuers_normalize_without_promoting_new_roots(self):
        container = pkcs7.serialize_certificates([self.chain.root, self.chain.intermediate], serialization.Encoding.DER)
        raw = EvidenceSet(NOW, (container, pem(self.chain.intermediate), der(self.chain.leaf)),
                          (issued_crl(self.chain.root, self.chain.root_key), b'not a CRL'), (b'not OCSP',))
        normalized = self.api.normalize_evidence(raw)
        self.assertEqual(set(normalized.certificates), {der(self.chain.root), der(self.chain.intermediate), der(self.chain.leaf)})
        self.assertEqual(len(normalized.crls), 1)
        self.assertEqual(normalized.ocsps, ())
        self.assertEqual(normalized.observed_at, NOW)
        self.assertEqual(self.trust.sha256, self.ctx.request.trust_bundle_sha256)

    def test_empty_and_unparseable_material_produces_no_evidence_or_endpoint(self):
        empty = EvidenceSet(NOW, (b'not a certificate',), (b'not a CRL',), (b'not OCSP',))
        normalized = self.api.normalize_evidence(empty)
        self.assertEqual((normalized.certificates, normalized.crls, normalized.ocsps), ((), (), ()))
        self.assertEqual(self.api.discover_targets((), normalized, self.trust, self.rules), ())
