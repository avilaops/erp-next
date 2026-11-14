from types import SimpleNamespace
import unittest

from helpers import load, validation_fixture


class PipelineBudgetTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls): cls.fixture = validation_fixture()

    async def test_query_limit_is_shared_between_discovery_rounds(self):
        api, egress = load(self, 'gateway'), load(self, 'egress')
        _, context, _, evidence, trust = self.fixture
        config = load(self, 'config').ServiceConfig(trust, egress.NetworkPolicy({'http://ca.example': ('/',)}))
        calls, queries = [], []
        class Worker:
            async def call(self, stage, frame, ctx, material, **kwargs):
                calls.append(stage)
                targets = tuple(egress.FetchTarget('crls', f'http://ca.example/r{len(calls)}/{index}.crl')
                                for index in range(12)) if stage == 'discover' else ()
                return SimpleNamespace(terminal=stage == 'validate', targets=targets, evidence=material)
        class Collector:
            async def fetch(self, target, **kwargs):
                queries.append(target)
                return b'untrusted DER, never an acceptance'
        result = await api.Pipeline(config, Worker(), Collector()).run(b'opaque', context)
        self.assertTrue(result.terminal)
        self.assertEqual(len(queries), 12)
        self.assertEqual(calls, ['discover', 'discover', 'validate'])

    async def test_collection_deadline_dedup_and_final_offline_stage(self):
        api, egress = load(self, 'gateway'), load(self, 'egress')
        _, context, _, evidence, trust = self.fixture
        config = load(self, 'config').ServiceConfig(trust, egress.NetworkPolicy({'http://ca.example': ('/',)}))
        elapsed, calls, queries = [0.0], [], []
        targets = tuple(egress.FetchTarget('crls', f'http://ca.example/{i}.crl') for i in range(12))
        class Worker:
            async def call(self, stage, frame, ctx, material, **kwargs):
                calls.append(stage)
                return SimpleNamespace(terminal=stage == 'validate', targets=targets, evidence=material)
        class Collector:
            async def fetch(self, target, *, timeout):
                queries.append((target, timeout))
                elapsed[0] += 3
                raise ValueError('network unavailable')
        await api.Pipeline(config, Worker(), Collector(), monotonic=lambda: elapsed[0]).run(b'opaque', context)
        self.assertEqual(len(queries), 4)
        self.assertEqual(len({target for target, _ in queries}), 4)
        self.assertEqual(calls[-1], 'validate')
        self.assertEqual([seconds for _, seconds in queries], [3, 3, 3, 3])
