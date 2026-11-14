import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from helpers import ROOT, load


class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.api = load(self, 'config')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.roots = (ROOT / 'deploy/fiscal/icp-brasil-roots.pem').read_bytes()
        self.intermediates = (ROOT / 'deploy/fiscal/icp-brasil-intermediates.pem').read_bytes()
        (self.root / 'roots.pem').write_bytes(self.roots)
        (self.root / 'intermediates.pem').write_bytes(self.intermediates)
        self.rules = {'schemaVersion': 'avila-evidence-origins/1',
            'rules': {'http://ac.example': ['/public/']},
            'provenance': {'rootsPemSha256': hashlib.sha256(self.roots).hexdigest(),
                'intermediatesPemSha256': hashlib.sha256(self.intermediates).hexdigest()}}
        self.write_rules()

    def write_rules(self):
        (self.root / 'evidence-origins.json').write_text(json.dumps(self.rules), encoding='utf-8')

    def test_public_pinned_trust_and_exact_provenance_are_loaded(self):
        config = self.api.load_config(self.root)
        self.assertEqual(config.trust.profile, 'icp_brasil')
        self.assertTrue(config.trust.root_der)
        self.assertEqual(config.policy.version, 'contract-icp/1')

    def test_synthetic_roots_are_never_enabled_by_environment(self):
        from fixtures import chain_fixture, pem
        (self.root / 'roots.pem').write_bytes(pem(chain_fixture().root))
        self.rules['provenance']['rootsPemSha256'] = hashlib.sha256(pem(chain_fixture().root)).hexdigest()
        self.write_rules()
        with patch.dict(os.environ, {'ALLOW_SYNTHETIC': '1', 'VALIDATOR_ALLOW_SYNTHETIC': 'true'}):
            with self.assertRaisesRegex(self.api.ConfigurationError, '^invalid_service_configuration$'):
                self.api.load_config(self.root)

    def test_wrong_provenance_unknown_fields_and_oversized_files_are_rejected(self):
        self.rules['provenance']['rootsPemSha256'] = '0'*64
        self.write_rules()
        with self.assertRaises(self.api.ConfigurationError): self.api.load_config(self.root)
        self.rules['command'] = 'never accepted'
        self.write_rules()
        with self.assertRaises(self.api.ConfigurationError): self.api.load_config(self.root)
        (self.root / 'evidence-origins.json').write_bytes(b' '*32769)
        with self.assertRaises(self.api.ConfigurationError): self.api.load_config(self.root)

    def test_relative_paths_and_non_regular_config_files_are_rejected(self):
        with self.assertRaises(self.api.ConfigurationError): self.api.load_config(Path('relative'))
        (self.root / 'roots.pem').unlink()
        (self.root / 'roots.pem').mkdir()
        with self.assertRaises(self.api.ConfigurationError): self.api.load_config(self.root)
