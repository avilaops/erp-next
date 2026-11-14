from dataclasses import replace
import hashlib
import json
import struct
import unittest

from helpers import load, validation_fixture
from contract_signature_validator.model import EvidenceSet
from contract_signature_validator.transport import MAGIC as FRAME_MAGIC, canonical_json, encode_request
from fixtures import NOW


class IpcTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = validation_fixture()

    def setUp(self):
        self.api = load(self, 'ipc')
        self.auth, self.ctx, self.report, self.evidence, self.trust = self.fixture
        self.config = load(self, 'config').ServiceConfig(self.trust,
            load(self, 'egress').NetworkPolicy({'http://revocation.invalid': ('/',), 'http://ocsp.invalid': ('/',)}))
        self.frame = encode_request(self.ctx.request)

    def test_job_round_trip_retains_original_authenticated_context_and_evidence(self):
        for stage in ('discover', 'validate'):
            packet = self.api.encode_job(stage, self.frame, self.ctx, self.evidence)
            context, evidence = self.api.decode_job(packet, self.config, stage=stage)
            self.assertEqual(context, self.ctx)
            self.assertEqual(evidence.sha256, self.evidence.sha256)

    def test_original_noncanonical_authenticated_bytes_are_not_reencoded_in_transit(self):
        start = len(FRAME_MAGIC)
        size = struct.unpack('>I', self.frame[start:start+4])[0]
        metadata = json.loads(self.frame[start+4:start+4+size])
        raw = json.dumps(metadata, indent=2).encode('ascii')
        frame = FRAME_MAGIC+struct.pack('>I', len(raw))+raw+self.frame[start+4+size:]
        headers = self.auth.headers_for(frame, operation='increment', request_id=self.ctx.request.request_id,
                                        key_id='test', sent_at=NOW)
        context = self.auth.decode_request(frame, list(headers.items()), method='POST', target='/internal/v1/increment',
            now=NOW, policy_sha256=self.ctx.request.policy_sha256, trust_bundle_sha256=self.ctx.request.trust_bundle_sha256)
        packet = self.api.encode_job('validate', frame, context, self.evidence)
        received, _ = self.api.decode_job(packet, self.config, stage='validate')
        self.assertEqual(received.request_sha256, hashlib.sha256(frame).hexdigest())
        self.assertEqual(received.request, self.ctx.request)

    def test_job_hash_stage_config_and_trailing_bytes_cannot_be_changed(self):
        packet = self.api.encode_job('validate', self.frame, self.ctx, self.evidence)
        for changed in (packet+b'x', packet[:-1], packet[:-1]+bytes([packet[-1]^1])):
            with self.assertRaises(self.api.IpcError):
                self.api.decode_job(changed, self.config, stage='validate')
        with self.assertRaises(self.api.IpcError):
            self.api.decode_job(packet, self.config, stage='discover')
        with self.assertRaises(self.api.IpcError):
            self.api.encode_job('validate', self.frame+b'x', self.ctx, self.evidence)

    def test_result_round_trip_and_terminal_shape_are_bound_to_the_request(self):
        result = load(self, 'engine').run_engine('validate', self.ctx, self.evidence, self.config)
        packet = self.api.encode_result('validate', result, self.ctx)
        received = self.api.decode_result(packet, self.ctx, self.config, stage='validate')
        self.assertEqual(received, result)
        with self.assertRaises(self.api.IpcError):
            self.api.decode_result(packet, replace(self.ctx, request=replace(self.ctx.request,
                document_id=self.ctx.request.tenant_id)), self.config, stage='validate')

    def test_unknown_fields_and_claimed_large_lengths_fail_before_blob_parsing(self):
        packet = self.api.encode_job('validate', self.frame, self.ctx, self.evidence)
        start = len(self.api.MAGIC)
        size = struct.unpack('>I', packet[start:start+4])[0]
        metadata = json.loads(packet[start+4:start+4+size])
        for updated in (metadata | {'command': 'never execute this'},
                        metadata | {'parts': [metadata['parts'][0] | {'length': 2**40}, *metadata['parts'][1:]]}):
            raw = canonical_json(updated)
            changed = self.api.MAGIC+struct.pack('>I', len(raw))+raw+packet[start+4+size:]
            with self.assertRaises(self.api.IpcError):
                self.api.decode_job(changed, self.config, stage='validate')
