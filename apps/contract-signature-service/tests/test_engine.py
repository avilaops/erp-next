from dataclasses import replace
import hashlib
import json
import unittest

from helpers import load, validation_fixture
from contract_signature_validator.model import EvidenceSet, ExpectedSigner
from contract_signature_validator.transport import encode_request
from fixtures import NOW, add_unsupported_timestamp, chain_fixture, der, issued_crl


class EngineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = validation_fixture()

    def setUp(self):
        self.api = load(self, 'engine')
        self.config_api = load(self, 'config')
        egress = load(self, 'egress')
        self.auth, self.ctx, self.report, self.evidence, self.trust = self.fixture
        self.config = self.config_api.ServiceConfig(self.trust,
            egress.NetworkPolicy({'http://revocation.invalid': ('/',), 'http://ocsp.invalid': ('/',)}))

    def context(self, request):
        frame = encode_request(request)
        headers = self.auth.headers_for(frame, operation=request.operation, request_id=request.request_id,
                                        key_id='test', sent_at=NOW)
        return self.auth.decode_request(frame, list(headers.items()), method='POST',
            target='/internal/v1/'+request.operation, now=NOW,
            policy_sha256=request.policy_sha256, trust_bundle_sha256=request.trust_bundle_sha256)

    def test_final_offline_validation_returns_exact_response_and_complete_material(self):
        result = self.api.run_engine('validate', self.ctx, self.evidence, self.config)
        response = json.loads(result.response)
        self.assertEqual(response['report']['verdict'], 'accepted')
        self.assertEqual(result.evidence.sha256, self.evidence.sha256)
        self.assertEqual(result.targets, ())
        self.assertTrue(result.terminal)

    def test_missing_revocation_discovers_only_approved_targets_and_remains_indeterminate(self):
        result = self.api.run_engine('discover', self.ctx, EvidenceSet(NOW), self.config)
        self.assertEqual(json.loads(result.response)['report']['verdict'], 'indeterminate')
        self.assertFalse(result.terminal)
        self.assertTrue(result.targets)
        for target in result.targets:
            self.config.network_policy.approve(target)
        self.assertTrue(result.evidence.certificates)  # Embedded CMS certificates are retained.

    def test_wrong_identity_never_starts_discovery(self):
        request = replace(self.ctx.request, signer=ExpectedSigner(self.ctx.request.signer.participant_id, '01234567890'))
        result = self.api.run_engine('discover', self.context(request), EvidenceSet(NOW), self.config)
        self.assertEqual(json.loads(result.response)['report']['verdict'], 'invalid')
        self.assertTrue(result.terminal)
        self.assertEqual(result.targets, ())

    def test_preflight_is_supported_without_personal_network_collection(self):
        request = replace(self.ctx.request, operation='preflight', parent=None, candidate=None,
                          signer=None, previous_signers=())
        result = self.api.run_engine('discover', self.context(request), EvidenceSet(NOW), self.config)
        self.assertEqual(json.loads(result.response)['report']['verdict'], 'accepted')
        self.assertTrue(result.terminal)
        self.assertEqual(result.targets, ())

    def test_stale_or_malformed_revocation_does_not_become_acceptance(self):
        chain = chain_fixture()
        for crls in ((b'not a CRL',), (issued_crl(chain.intermediate, chain.intermediate_key, stale=True),)):
            result = self.api.run_engine('validate', self.ctx, EvidenceSet(NOW, crls=crls), self.config)
            self.assertEqual(json.loads(result.response)['report']['verdict'], 'indeterminate')

    def test_revoked_certificate_is_negative_and_never_replaced_by_missing_evidence(self):
        chain = chain_fixture()
        evidence = replace(self.evidence, crls=(issued_crl(chain.root, chain.root_key),
            issued_crl(chain.intermediate, chain.intermediate_key, revoked=(chain.leaf.serial_number,))))
        result = self.api.run_engine('discover', self.ctx, evidence, self.config)
        self.assertEqual(json.loads(result.response)['report']['verdict'], 'invalid')
        self.assertTrue(result.terminal)

    def test_configuration_observation_and_stage_are_fixed_by_the_service(self):
        for changes in ({'policy_sha256': '0'*64}, {'trust_bundle_sha256': '0'*64}):
            with self.assertRaisesRegex(self.api.EngineError, '^validation_configuration_mismatch$'):
                self.api.run_engine('validate', replace(self.ctx, request=replace(self.ctx.request, **changes)), self.evidence, self.config)
        with self.assertRaises(self.api.EngineError):
            self.api.run_engine('network', self.ctx, self.evidence, self.config)

    def test_unsupported_timestamp_in_base_is_never_reported_as_absent(self):
        base = add_unsupported_timestamp(self.ctx.request.base)
        request = replace(self.ctx.request, base=base, parent=base, candidate=base+b'candidate')
        result = self.api.run_engine('validate', self.context(request), EvidenceSet(NOW), self.config)
        report = json.loads(result.response)['report']
        self.assertEqual(report['verdict'], 'unsupported')
        self.assertEqual(report['timestampStatus'], 'unsupported')
