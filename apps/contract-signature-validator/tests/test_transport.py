"""Pure framing tests. Opaque fixture bytes never claim to be valid PDFs."""
from dataclasses import replace
import importlib
import importlib.util
import json
import struct
import unittest
from uuid import UUID

from contract_signature_validator.model import ExpectedSigner
from fixtures import CPF, DOCUMENT, PARTICIPANT

REQUEST = UUID('33333333-3333-4333-8333-333333333333')
TENANT = UUID('44444444-4444-4444-8444-444444444444')
ENVELOPE = UUID('55555555-5555-4555-8555-555555555555')
POLICY, TRUST = 'a' * 64, 'b' * 64


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec('contract_signature_validator.transport'))
        self.api = importlib.import_module('contract_signature_validator.transport')

    def request(self, operation='preflight'):
        return self.api.ValidationRequest(operation=operation, request_id=REQUEST,
            tenant_id=TENANT, envelope_id=ENVELOPE, document_id=DOCUMENT,
            policy_sha256=POLICY, trust_bundle_sha256=TRUST, base=b'opaque base',
            parent=b'opaque parent' if operation == 'increment' else None,
            candidate=b'opaque candidate' if operation == 'increment' else None,
            signer=ExpectedSigner(PARTICIPANT, CPF) if operation == 'increment' else None)

    def decode(self, frame, **overrides):
        args = dict(operation='preflight', request_id=REQUEST,
                    policy_sha256=POLICY, trust_bundle_sha256=TRUST)
        return self.api.decode_request(frame, **(args | overrides))

    def split(self, frame):
        start = len(self.api.MAGIC)
        size = struct.unpack('>I', frame[start:start + 4])[0]
        return json.loads(frame[start + 4:start + 4 + size]), frame[start + 4 + size:]

    def frame(self, metadata, payload):
        raw = json.dumps(metadata, sort_keys=True, separators=(',', ':')).encode('ascii')
        return self.api.MAGIC + struct.pack('>I', len(raw)) + raw + payload

    def test_round_trip_preserves_exact_parts_and_all_context(self):
        for operation in ('preflight', 'increment'):
            request = self.request(operation)
            encoded = self.api.encode_request(request)
            self.assertTrue(encoded.startswith(b'AVILA-CV1\n'))
            self.assertEqual(self.decode(encoded, operation=operation), request)
            self.assertEqual(self.api.encode_request(request), encoded)
            self.assertNotIn(CPF, repr(request))
            self.assertNotIn('opaque base', repr(request))
            with self.assertRaises((AttributeError, TypeError)):
                request.operation = 'increment'

    def test_rejects_unknown_fields_duplicate_keys_and_server_owned_values(self):
        frame = self.api.encode_request(self.request())
        metadata, payload = self.split(frame)
        for field in ('checkedAt', 'roots', 'path', 'url', 'baseline', 'evidence', 'policy'):
            with self.subTest(field=field), self.assertRaisesRegex(self.api.ProtocolError, '^invalid_request$'):
                self.decode(self.frame(metadata | {field: 'untrusted'}, payload))
        raw = json.dumps(metadata).replace('"operation": "preflight"',
            '"operation": "increment", "operation": "preflight"').encode('ascii')
        with self.assertRaises(self.api.ProtocolError):
            self.decode(self.api.MAGIC + struct.pack('>I', len(raw)) + raw + payload)
        nested = metadata | {'parts': [metadata['parts'][0] | {'url': 'http://127.0.0.1/'}]}
        with self.assertRaises(self.api.ProtocolError):
            self.decode(self.frame(nested, payload))

    def test_context_configuration_and_operation_cannot_be_replaced(self):
        frame = self.api.encode_request(self.request())
        for kwargs in ({'request_id': DOCUMENT}, {'operation': 'increment'},
                       {'policy_sha256': TRUST}, {'trust_bundle_sha256': POLICY}):
            with self.subTest(kwargs=kwargs), self.assertRaises(self.api.ProtocolError):
                self.decode(frame, **kwargs)
        metadata, payload = self.split(frame)
        for value in ('{'+str(REQUEST)+'}', str(REQUEST).replace('-', ''), str(UUID(int=0)), 1, None):
            with self.assertRaises(self.api.ProtocolError):
                self.decode(self.frame(metadata | {'requestId': value}, payload))

    def test_lengths_hashes_order_and_trailing_data_are_checked(self):
        frame = self.api.encode_request(self.request('increment'))
        metadata, payload = self.split(frame)
        for corrupt in (frame[:-1], frame+b'x', frame[:-1]+b'x', b'x'+frame,
                        self.api.MAGIC+b'\xff\xff\xff\xff'+b'{}'):
            with self.subTest(length=len(corrupt)), self.assertRaises(self.api.ProtocolError):
                self.decode(corrupt, operation='increment')
        for value in (True, 1.0, '11', 0, -1, 20*1024*1024+1):
            parts = [metadata['parts'][0] | {'length': value}, *metadata['parts'][1:]]
            with self.assertRaises(self.api.ProtocolError):
                self.decode(self.frame(metadata | {'parts': parts}, payload), operation='increment')
        for parts in (list(reversed(metadata['parts'])), metadata['parts']*2,
                      [metadata['parts'][0] | {'sha256': '0'*64}, *metadata['parts'][1:]]):
            with self.assertRaises(self.api.ProtocolError):
                self.decode(self.frame(metadata | {'parts': parts}, payload), operation='increment')

    def test_part_limits_accept_the_boundary_and_reject_one_more_byte(self):
        request = self.request('increment')
        for name, limit in (('base', 20*1024*1024), ('parent', 32*1024*1024), ('candidate', 32*1024*1024)):
            with self.subTest(name=name):
                boundary = replace(request, **{name: b'x'*limit})
                encoded = self.api.encode_request(boundary)
                self.assertEqual(len(getattr(self.decode(encoded, operation='increment'), name)), limit)
                del encoded, boundary
                with self.assertRaises(self.api.ProtocolError):
                    replace(request, **{name: b'x'*(limit+1)})

    def test_signer_sequence_and_operation_specific_shape_are_strict(self):
        request = self.request('increment')
        for previous in ([request.signer], (request.signer,),
                         (ExpectedSigner(REQUEST, CPF),), (request.signer,)*10):
            with self.assertRaises(self.api.ProtocolError):
                replace(request, previous_signers=previous)
        for changes in ({'signer': None}, {'candidate': None}, {'base': b''},
                        {'base': bytearray(b'x')}, {'operation': 'sign'}):
            with self.assertRaises(self.api.ProtocolError):
                replace(request, **changes)
        with self.assertRaises(self.api.ProtocolError):
            replace(self.request(), signer=request.signer)
        metadata, payload = self.split(self.api.encode_request(request))
        with self.assertRaises(self.api.ProtocolError):
            self.decode(self.frame(metadata | {'signer': metadata['signer'] | {'privateKey': 'never'}}, payload),
                        operation='increment')

    def test_pathological_json_and_non_ascii_or_non_object_headers_fail_closed(self):
        for raw in (b'[]', b'null', b'{"x": NaN}', b'{"x": Infinity}', b'{',
                    b'['*1500+b'0'+b']'*1500, b'\xff', b' '*32769):
            with self.subTest(size=len(raw)), self.assertRaisesRegex(self.api.ProtocolError, '^invalid_request$'):
                self.decode(self.api.MAGIC+struct.pack('>I', len(raw))+raw)
