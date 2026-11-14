import base64
import json
import os
from pathlib import Path
import ssl
import sys
import tempfile
import unittest
from unittest.mock import patch

from helpers import load


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.api = load(self, 'launcher')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.key = b'SYNTHETIC-GATEWAY-TEST-KEY-ONLY!!!'
        self.config = {'schemaVersion': 'avila-validator-keys/1',
                       'keys': {'current': base64.b64encode(self.key).decode('ascii')}}
        (self.root/'hmac.json').write_text(json.dumps(self.config), encoding='utf-8')
        (self.root/'tls.pem').write_bytes(b'SYNTHETIC TLS PUBLIC TEST')
        (self.root/'tls-key.pem').write_bytes(b'SYNTHETIC TLS PRIVATE TEST')
        for name in ('hmac.json', 'tls-key.pem'): (self.root/name).chmod(0o600)

    def test_only_explicit_dedicated_keys_and_mandatory_tls_are_loaded(self):
        with patch.object(ssl.SSLContext, 'load_cert_chain') as chain:
            auth, context = self.api.load_gateway_security(self.root)
        self.assertEqual(dict(auth._keys), {'current': self.key})
        self.assertEqual(context.protocol, ssl.PROTOCOL_TLS_SERVER)
        self.assertEqual(context.minimum_version, ssl.TLSVersion.TLSv1_2)
        self.assertIsNotNone(chain.call_args.kwargs['password'])

    def test_missing_invalid_or_default_security_is_not_repaired_from_environment(self):
        self.config['keys']['current'] = base64.b64encode(b'short').decode('ascii')
        (self.root/'hmac.json').write_text(json.dumps(self.config), encoding='utf-8')
        with patch.dict(os.environ, {'VALIDATOR_DISABLE_TLS': '1', 'VALIDATOR_HMAC_KEY': 'a'*32}):
            with self.assertRaises(self.api.ConfigurationError): self.api.load_gateway_security(self.root)
        (self.root/'hmac.json').unlink()
        with self.assertRaises(self.api.ConfigurationError): self.api.load_gateway_security(self.root)

    def test_cli_has_no_synthetic_or_downgrade_mode_and_fails_on_nonlinux(self):
        for args in ([], ['test'], ['worker', '--synthetic'], ['gateway', '--no-tls']):
            self.assertEqual(self.api.main(args), 78)
        with patch.object(self.api.sys, 'platform', 'win32'):
            self.assertEqual(self.api.main(['gateway']), 78)
            self.assertEqual(self.api.main(['worker']), 78)

    @unittest.skipUnless(sys.platform == 'linux', 'Linux secret permissions gate')
    def test_group_readable_or_wrong_owner_secrets_are_rejected(self):
        (self.root/'hmac.json').chmod(0o640)
        with self.assertRaises(self.api.ConfigurationError): self.api.load_gateway_security(self.root)
        (self.root/'hmac.json').chmod(0o600)
        other_uid = 10002 if os.geteuid() == 10001 else 10001
        with patch.object(self.api.os, 'geteuid', return_value=other_uid):
            with self.assertRaises(self.api.ConfigurationError): self.api.load_gateway_security(self.root)
