from dataclasses import replace
import hashlib
import json
import struct
import unittest

from helpers import load, validation_fixture
from contract_signature_validator.model import EvidenceSet, Verdict
from contract_signature_validator.transport import canonical_json
from contract_signature_validator.transport_auth import AuthenticationError
from fixtures import CPF, NOW, certificate


class BundleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = validation_fixture()

    def setUp(self):
        self.api = load(self, 'bundle')
        self.auth, self.context, self.report, self.evidence, self.trust = self.fixture

    def encode(self, **overrides):
        values = dict(authenticated=self.context, report=self.report, evidence=self.evidence,
                      trust=self.trust, authenticator=self.auth)
        return self.api.encode_bundle(**(values | overrides))

    def decode(self, body, headers, **overrides):
        kwargs = dict(trust_profile='synthetic_not_icp', now=NOW)
        return self.api.decode_bundle(body, list(headers.items()), self.context, self.auth, **(kwargs | overrides))

    def resign(self, body):
        return {'content-type': self.api.CONTENT_TYPE, 'content-length': str(len(body)),
            'x-validation-response-sha256': hashlib.sha256(body).hexdigest(),
            'x-validation-response-mac': 'HMAC-SHA256 test:'+self.auth.response_mac(body, self.context)}

    def split(self, body):
        start = len(self.api.MAGIC)
        size = struct.unpack('>I', body[start:start+4])[0]
        metadata, payload = json.loads(body[start+4:start+4+size]), body[start+4+size:]
        offset, blobs = 0, []
        for part in metadata['parts']:
            blobs.append(payload[offset:offset+part['length']])
            offset += part['length']
        return metadata, blobs

    def frame(self, metadata, blobs):
        raw = canonical_json(metadata)
        return self.api.MAGIC+struct.pack('>I', len(raw))+raw+b''.join(blobs)

    def test_real_core_result_and_all_offline_material_round_trip(self):
        self.assertEqual(self.report.verdict, Verdict.ACCEPTED)
        body, headers = self.encode()
        result = self.decode(body, headers)
        self.assertEqual(result.response['report']['verdict'], 'accepted')
        self.assertEqual(result.evidence.sha256, self.evidence.sha256)
        self.assertEqual(result.trust.sha256, self.trust.sha256)
        self.assertEqual(result.sha256, hashlib.sha256(body).hexdigest())
        self.assertNotIn(CPF, repr(result))
        self.assertEqual(self.encode(), (body, headers))

    def test_exact_binary_authentication_precedes_decoding(self):
        body, headers = self.encode()
        for changed in (body+b'x', body[:-1], body[:-1]+bytes([body[-1]^1])):
            with self.assertRaises(AuthenticationError):
                self.decode(changed, headers)
        with self.assertRaises(self.api.BundleError):
            self.decode(body, headers, trust_profile='icp_brasil')
        with self.assertRaises(AuthenticationError):
            self.decode(body, headers | {'content-type': 'application/json'})

    def test_encoder_requires_every_evidence_hash_used_in_the_report(self):
        for kind in ('certificates', 'crls'):
            values = getattr(self.evidence, kind)
            with self.assertRaises(self.api.BundleError):
                self.encode(evidence=replace(self.evidence, **{kind: values[1:]}))

    def test_rehashed_manifest_cannot_hide_a_missing_required_der(self):
        body, _ = self.encode()
        metadata, blobs = self.split(body)
        index = next(i for i, part in enumerate(metadata['parts']) if part['name'] == 'crls')
        removed = blobs.pop(index)
        metadata['parts'].pop(index)
        for part in metadata['parts']:
            if part['name'] == 'crls': part['index'] -= 1
        evidence = replace(self.evidence, crls=tuple(blob for blob in self.evidence.crls if blob != removed))
        metadata['evidenceSetSha256'] = evidence.sha256
        changed = self.frame(metadata, blobs)
        with self.assertRaises(self.api.BundleError):
            self.decode(changed, self.resign(changed))

    def test_trust_snapshot_cannot_select_a_different_anchor(self):
        from asn1crypto import pem
        body, _ = self.encode()
        metadata, blobs = self.split(body)
        index = next(i for i, part in enumerate(metadata['parts']) if part['name'] == 'rootsPem')
        blobs[index] = pem.armor('CERTIFICATE', certificate(ca=True))
        metadata['parts'][index].update(length=len(blobs[index]), sha256=hashlib.sha256(blobs[index]).hexdigest())
        changed = self.frame(metadata, blobs)
        with self.assertRaises(self.api.BundleError):
            self.decode(changed, self.resign(changed))

    def test_unknown_duplicate_reordered_trailing_or_oversized_parts_fail_closed(self):
        body, _ = self.encode()
        metadata, blobs = self.split(body)
        altered = metadata | {'debug': 'must not be accepted'}
        corrupt = [self.frame(altered, blobs), body+b'x',
            self.frame(metadata | {'parts': list(reversed(metadata['parts']))}, list(reversed(blobs))),
            self.frame(metadata | {'parts': metadata['parts']+[metadata['parts'][-1]]}, blobs+[blobs[-1]])]
        for changed in corrupt:
            with self.assertRaises(self.api.BundleError):
                self.decode(changed, self.resign(changed))
        with self.assertRaises(AuthenticationError):
            self.decode(b'x'*(40*1024*1024+1), self.resign(b'x'*(40*1024*1024+1)))
