from dataclasses import replace
from datetime import timedelta
import hashlib
import importlib
import importlib.util
import json
import unittest

from contract_signature_validator.model import (BaselineInventory, CheckResult, EvidenceSet,
    PreflightBinding, PreflightReport, ValidationBinding, ValidationPolicy, ValidationReport, Verdict)
from contract_signature_validator.trust import load_trust_bundle
from contract_signature_validator.validation import preflight, validate_increment
from fixtures import CPF, NOW, PARTICIPANT, chain_fixture, der, issued_crl, pem, sealed_pdf, sign_pdf
import test_transport as wire_tests
from test_transport_auth import KEY


class ResponseTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec('contract_signature_validator.transport_response'))
        self.api = importlib.import_module('contract_signature_validator.transport_response')
        self.wire = importlib.import_module('contract_signature_validator.transport')
        self.auth_api = importlib.import_module('contract_signature_validator.transport_auth')
        self.auth = self.auth_api.TransportAuthenticator({'current': KEY})
        helper = wire_tests.TransportTests()
        helper.api = self.wire
        self.request = helper.request()
        self.authenticated = self.authenticate(self.request)

    def authenticate(self, request, now=NOW):
        body = self.wire.encode_request(request)
        headers = self.auth.headers_for(body, operation=request.operation,
            request_id=request.request_id, key_id='current', sent_at=NOW)
        return self.auth.decode_request(body, list(headers.items()), method='POST',
            target=self.wire.TARGETS[request.operation], now=now,
            policy_sha256=request.policy_sha256, trust_bundle_sha256=request.trust_bundle_sha256)

    def report(self, authenticated=None):
        ctx = authenticated or self.authenticated
        req = ctx.request
        digest = hashlib.sha256(req.base).hexdigest()
        binding = PreflightBinding(req.document_id, digest, req.policy_sha256,
                                   req.trust_bundle_sha256, ctx.observed_at)
        checks = tuple(CheckResult(name, Verdict.ACCEPTED, 'validated') for name in ('binding', 'format', 'baseline'))
        baseline = BaselineInventory(req.document_id, digest, len(req.base), req.policy_sha256,
                                     req.trust_bundle_sha256, ())
        return PreflightReport(binding, checks, 'synthetic_not_icp', baseline)

    def encode(self, report=None, authenticated=None):
        return self.api.encode_response(authenticated or self.authenticated,
            report or self.report(authenticated), trust_profile='synthetic_not_icp')

    def verify(self, body, headers, *, authenticated=None, **kwargs):
        return self.api.verify_response(body, list(headers.items()) if isinstance(headers, dict) else headers,
            authenticated or self.authenticated, self.auth,
            **(dict(trust_profile='synthetic_not_icp', now=NOW) | kwargs))

    def seal(self, body, authenticated=None):
        return self.api.seal_response(body, authenticated or self.authenticated, self.auth,
                                      trust_profile='synthetic_not_icp')

    def test_preflight_round_trip_preserves_the_core_verdict_and_hashes(self):
        body = self.encode()
        headers = self.seal(body)
        result = self.verify(body, headers)
        self.assertEqual(result['report']['verdict'], 'accepted')
        self.assertEqual(result['report']['trustProfile'], 'synthetic_not_icp')
        self.assertEqual(result['requestSha256'], self.authenticated.request_sha256)
        self.assertEqual(result['reportSha256'], hashlib.sha256(self.wire.canonical_json(result['report'])).hexdigest())
        self.assertNotIn(CPF.encode(), body)
        self.assertEqual(body, self.encode())
        with self.assertRaises(self.wire.ProtocolError):
            self.verify(body, headers, trust_profile='icp_brasil')

    def test_synthetic_signed_pdf_increment_survives_the_real_core_and_transport(self):
        helper = wire_tests.TransportTests()
        helper.api = self.wire
        chain, base = chain_fixture(), sealed_pdf()
        trust, policy = load_trust_bundle(pem(chain.root), allow_synthetic=True), ValidationPolicy()
        evidence = EvidenceSet(observed_at=NOW, certificates=(der(chain.intermediate),), crls=(
            issued_crl(chain.root, chain.root_key), issued_crl(chain.intermediate, chain.intermediate_key)))
        candidate = sign_pdf(base, der(chain.leaf), chain.leaf_key, 'Personal', issuer=chain.intermediate, root=chain.root)
        request = replace(helper.request('increment'), base=base, parent=base, candidate=candidate,
                          policy_sha256=policy.sha256, trust_bundle_sha256=trust.sha256)
        ctx = self.authenticate(request)
        opened = preflight(base, PreflightBinding(request.document_id, hashlib.sha256(base).hexdigest(),
            policy.sha256, trust.sha256, NOW), policy, trust, evidence)
        report = validate_increment(base, candidate, ValidationBinding(request.document_id, PARTICIPANT,
            hashlib.sha256(base).hexdigest(), hashlib.sha256(candidate).hexdigest(), policy.sha256, trust.sha256, NOW),
            request.signer, (), opened.baseline, policy, trust, evidence)
        self.assertEqual(report.verdict, Verdict.ACCEPTED)
        body = self.encode(report, ctx)
        headers = self.seal(body, ctx)
        result = self.verify(body, headers, authenticated=ctx)
        self.assertEqual(result['report']['verdict'], 'accepted')
        self.assertEqual(result['report']['longTermValidation'], 'not_established')

    def test_missing_checks_remain_indeterminate_and_bindings_cannot_be_replaced(self):
        report = self.report()
        body = self.encode(replace(report, checks=()))
        headers = self.seal(body)
        self.assertEqual(self.verify(body, headers)['report']['verdict'], 'indeterminate')
        for changes in ({'document_id': self.request.request_id}, {'checked_at': NOW+timedelta(seconds=1)},
                        {'policy_sha256': '0'*64}, {'trust_bundle_sha256': '0'*64}, {'base_sha256': '0'*64}):
            mismatched = replace(report, binding=replace(report.binding, **changes), baseline=None)
            with self.assertRaises(self.wire.ProtocolError):
                self.encode(mismatched)

    def test_response_cannot_be_replayed_for_another_request_tenant_or_body(self):
        body = self.encode()
        headers = self.seal(body)
        for changes in ({'request_id': self.request.document_id}, {'tenant_id': self.request.document_id},
                        {'envelope_id': self.request.document_id}, {'base': b'other base'}):
            with self.assertRaises((self.wire.ProtocolError, self.auth_api.AuthenticationError)):
                self.verify(body, headers, authenticated=self.authenticate(replace(self.request, **changes)))
        for changed in (body+b'x', body[:-1], body.replace(b'accepted', b'invalid_')):
            with self.assertRaises(self.auth_api.AuthenticationError):
                self.verify(changed, headers)
        request_headers = self.auth.headers_for(body, operation='preflight', request_id=self.request.request_id,
                                               key_id='current', sent_at=NOW)
        reflected = headers | {'x-validation-response-mac': request_headers['authorization']}
        with self.assertRaises(self.auth_api.AuthenticationError):
            self.verify(body, reflected)

    def test_response_observation_is_service_owned_but_verifiable_by_a_remote_caller(self):
        server = self.authenticate(self.request, now=NOW+timedelta(seconds=2))
        body = self.encode(authenticated=server)
        headers = self.seal(body, server)
        self.assertEqual(self.verify(body, headers, now=NOW+timedelta(seconds=3))['report']['verdict'], 'accepted')
        for now in (NOW+timedelta(seconds=63), NOW-timedelta(seconds=4)):
            with self.assertRaises(self.wire.ProtocolError):
                self.verify(body, headers, now=now)

    def test_sealing_refuses_forged_verdict_unknown_fields_or_oversized_output(self):
        raw = json.loads(self.encode(replace(self.report(), checks=())))
        for mutated in (raw | {'debugCpf': CPF}, raw | {'report': raw['report'] | {'verdict': 'accepted'}},
                        raw | {'report': raw['report'] | {'trustProfile': 'icp_brasil'}}):
            mutated['reportSha256'] = hashlib.sha256(self.wire.canonical_json(mutated['report'])).hexdigest()
            with self.assertRaises(self.wire.ProtocolError):
                self.seal(self.wire.canonical_json(mutated))
        with self.assertRaises(self.wire.ProtocolError):
            self.seal(b'x'*(256*1024+1))
