from datetime import timedelta
import hashlib
import importlib
import importlib.util
import unittest
from unittest.mock import patch

from fixtures import NOW
from test_transport import DOCUMENT, POLICY, REQUEST, TRUST
import test_transport as wire_tests

KEY = b'synthetic-transport-test-key-only!'
NEXT_KEY = b'synthetic-next-test-key-not-real!'


class AuthenticationTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec('contract_signature_validator.transport_auth'))
        self.api = importlib.import_module('contract_signature_validator.transport_auth')
        self.framing = importlib.import_module('contract_signature_validator.transport')
        self.auth = self.api.TransportAuthenticator({'current': KEY, 'next': NEXT_KEY})
        helper = wire_tests.TransportTests()
        helper.api = self.framing
        self.request = helper.request()
        self.body = self.framing.encode_request(self.request)

    def headers(self, body=None, **kwargs):
        return self.auth.headers_for(self.body if body is None else body,
            **(dict(operation='preflight', request_id=REQUEST, key_id='current', sent_at=NOW) | kwargs))

    def decode(self, *, body=None, headers=None, **kwargs):
        return self.auth.decode_request(self.body if body is None else body,
            list((self.headers() if headers is None else headers).items()) if isinstance(headers, (dict, type(None))) else headers,
            **(dict(method='POST', target='/internal/v1/preflight', now=NOW,
                    policy_sha256=POLICY, trust_bundle_sha256=TRUST) | kwargs))

    def test_current_and_rotated_keys_authenticate_the_exact_body_and_observed_time(self):
        for key in ('current', 'next'):
            authenticated = self.decode(headers=self.headers(key_id=key))
            self.assertEqual(authenticated.request, self.request)
            self.assertEqual(authenticated.observed_at, NOW)
            self.assertEqual(authenticated.key_id, key)
            self.assertEqual(authenticated.request_sha256, hashlib.sha256(self.body).hexdigest())
            self.assertNotIn(KEY.decode(), repr(authenticated))
        original = {'current': KEY}
        isolated = self.api.TransportAuthenticator(original)
        original['current'] = NEXT_KEY
        self.assertEqual(isolated.decode_request(self.body, list(self.headers().items()), method='POST',
            target='/internal/v1/preflight', now=NOW, policy_sha256=POLICY,
            trust_bundle_sha256=TRUST).request, self.request)
        self.assertNotIn(KEY.decode(), repr(self.auth))

    def test_invalid_authentication_is_rejected_before_json_or_pdf_parsing(self):
        headers = self.headers() | {'authorization': 'HMAC-SHA256 current:'+'0'*64}
        with patch('contract_signature_validator.transport.decode_request', side_effect=AssertionError('must not parse')):
            with self.assertRaisesRegex(self.api.AuthenticationError, '^unauthorized$'):
                self.decode(body=b'not even a frame', headers=headers)
        headers = self.headers() | {'x-validation-content-sha256': '0'*64}
        with self.assertRaises(self.api.AuthenticationError):
            self.decode(headers=headers)

    def test_signed_headers_do_not_authorize_changed_content_or_other_context(self):
        for body in (self.body+b'x', self.body[:-1], self.body[:-1]+b'x'):
            with self.assertRaisesRegex(self.api.AuthenticationError, '^unauthorized$'):
                self.decode(body=body)
        for kwargs in ({'method': 'GET'}, {'target': '/internal/v1/increment'},
                       {'target': '/internal/v1/preflight?debug=true'}, {'target': 'https://erp.avilaops.com/internal/v1/preflight'}):
            with self.assertRaises(self.api.AuthenticationError):
                self.decode(**kwargs)
        with self.assertRaises(self.framing.ProtocolError):
            self.decode(headers=self.headers(request_id=DOCUMENT))

    def test_timestamp_age_and_future_tolerance_are_exact_and_utc_only(self):
        for seconds in (0, 60, -5):
            self.assertEqual(self.decode(headers=self.headers(sent_at=NOW-timedelta(seconds=seconds))).request, self.request)
        for seconds in (61, -6):
            with self.assertRaises(self.api.AuthenticationError):
                self.decode(headers=self.headers(sent_at=NOW-timedelta(seconds=seconds)))
        for stamp in ('0'+str(int(NOW.timestamp())), str(NOW.timestamp()), 'NaN', '-1', '9'*100):
            with self.assertRaises(self.api.AuthenticationError):
                self.decode(headers=self.headers() | {'x-validation-time': stamp})
        with self.assertRaises(self.api.AuthenticationError):
            self.decode(now=NOW.replace(tzinfo=None))

    def test_duplicate_headers_encoding_and_header_budgets_are_rejected(self):
        items = list(self.headers().items())
        for headers in (items+[('Authorization', self.headers()['authorization'])],
                        items+[('transfer-encoding', 'chunked')], items+[('content-encoding', 'gzip')],
                        items+[('x-pad', 'x'*16385)], items+[(f'x-{i}', 'x') for i in range(33)]):
            with self.assertRaises(self.api.AuthenticationError):
                self.decode(headers=headers)
        for name, value in (('content-length', '0'+str(len(self.body))), ('content-length', str(len(self.body)+1)),
                            ('content-type', 'application/json'), ('authorization', 'Bearer '+KEY.decode()),
                            ('authorization', 'HMAC-SHA256 missing:'+'0'*64), ('x-validation-request-id', '0'*36)):
            with self.assertRaises(self.api.AuthenticationError):
                self.decode(headers=self.headers() | {name: value})

    def test_key_configuration_has_no_implicit_default_or_weak_secret(self):
        for keys in ({}, {'a': b'x'*31}, {'a': b'x'*65}, {'a': KEY.decode()},
                     {'a': KEY, 'b': KEY, 'c': KEY}, {'a\nb': KEY}):
            with self.assertRaisesRegex(ValueError, '^invalid_service_keys$'):
                self.api.TransportAuthenticator(keys)
