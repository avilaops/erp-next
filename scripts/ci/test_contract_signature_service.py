"""Guard deployment boundaries, not business validation internals."""
import hashlib
import json
from pathlib import Path
import re
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT/'deploy/contracts-validator'


class PrivateValidatorDeploymentTests(unittest.TestCase):
    def test_worker_is_offline_and_neither_container_publishes_ports_or_mounts_erp_secrets(self):
        config = yaml.safe_load((DEPLOY/'compose.yml').read_text(encoding='utf-8'))
        self.assertEqual(set(config['services']), {'gateway', 'worker'})
        gateway, worker = config['services']['gateway'], config['services']['worker']
        self.assertEqual(worker['network_mode'], 'none')
        self.assertEqual(worker['user'], '10002:10001')
        self.assertEqual(gateway['user'], '10001:10001')
        for service in (gateway, worker):
            self.assertTrue(service['read_only'])
            self.assertTrue(service['init'])
            self.assertEqual(service['cap_drop'], ['ALL'])
            self.assertIn('no-new-privileges:true', service['security_opt'])
            self.assertLessEqual(service['pids_limit'], 64)
            self.assertIn('mem_limit', service)
            self.assertIn('cpus', service)
            self.assertNotIn('ports', service)
            self.assertNotIn('privileged', service)
            self.assertNotIn('environment', service)
            self.assertIn('VALIDATOR_IMAGE', service['image'])
            self.assertFalse(any('docker.sock' in str(mount) for mount in service['volumes']))
        self.assertFalse(any('/run/secrets' in str(mount) for mount in worker['volumes']))
        self.assertIn('channel:/run/validator:ro', gateway['volumes'])

    def test_image_does_not_copy_source_tests_or_use_unpinned_base(self):
        dockerfile = (DEPLOY/'Dockerfile').read_text(encoding='utf-8')
        images = re.findall(r'^FROM\s+(\S+)', dockerfile, re.M)
        self.assertTrue(images)
        self.assertTrue(all('@sha256:' in value for value in images))
        copies = [line for line in dockerfile.splitlines() if line.startswith('COPY ') and '--from=' not in line]
        self.assertTrue(copies)
        self.assertFalse(any(re.search(r'\bCOPY\s+\.\s', line) or '/tests' in line or '.venv' in line for line in copies))
        self.assertIn('USER 10001:10001', dockerfile)
        self.assertIn('contract_signature_service', dockerfile)

    def test_egress_configuration_is_bound_to_the_existing_public_trust_files(self):
        rules = json.loads((DEPLOY/'evidence-origins.json').read_bytes())
        self.assertEqual(rules['schemaVersion'], 'avila-evidence-origins/1')
        for key, filename in (('rootsPemSha256', 'icp-brasil-roots.pem'),
                              ('intermediatesPemSha256', 'icp-brasil-intermediates.pem')):
            expected = hashlib.sha256((ROOT/'deploy/fiscal'/filename).read_bytes()).hexdigest()
            self.assertEqual(rules['provenance'][key], expected)
        self.assertTrue(rules['rules'])
        self.assertLessEqual(len(rules['rules']), 64)
        self.assertLessEqual(len((DEPLOY/'evidence-origins.json').read_bytes()), 32768)
