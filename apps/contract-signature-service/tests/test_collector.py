import json
import sys
import unittest
from unittest.mock import AsyncMock, patch

from helpers import load


class CollectorTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.api = load(self, 'collector')
        self.egress = load(self, 'egress')
        self.policy = self.egress.NetworkPolicy({'https://ca.example': ('/public/',)})
        self.target = self.egress.FetchTarget('crls', 'https://ca.example/public/current.crl')

    async def test_each_query_has_its_own_hard_limited_process_without_credentials(self):
        runner = AsyncMock(return_value=b'raw public evidence')
        with patch.object(self.api, 'run_bounded', runner):
            output = await self.api.EvidenceCollector(self.policy).fetch(self.target, timeout=1.75)
        self.assertEqual(output, b'raw public evidence')
        args, kwargs = runner.call_args
        self.assertEqual(args[0], (sys.executable, '-I', '-m', 'contract_signature_service.network_child'))
        self.assertEqual(kwargs, {'timeout': 1.75, 'output_limit': 8*1024*1024, 'profile': 'network'})
        target, policy = self.api.decode_fetch_job(args[1])
        self.assertEqual(target, self.target)
        self.assertEqual(dict(policy.rules), dict(self.policy.rules))

    async def test_private_targets_overlong_budgets_and_unknown_fields_never_spawn(self):
        runner = AsyncMock(return_value=b'anything')
        with patch.object(self.api, 'run_bounded', runner):
            for timeout in (0, -1, 4, float('nan'), True):
                with self.assertRaises(ValueError):
                    await self.api.EvidenceCollector(self.policy).fetch(self.target, timeout=timeout)
            with self.assertRaises(ValueError):
                await self.api.EvidenceCollector(self.policy).fetch(
                    self.egress.FetchTarget('crls', 'http://private.example/a'), timeout=3)
        runner.assert_not_called()
        raw = self.api.encode_fetch_job(self.target, self.policy)
        changed = json.loads(raw) | {'command': 'never execute'}
        with self.assertRaises(ValueError): self.api.decode_fetch_job(json.dumps(changed).encode())
