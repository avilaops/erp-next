import json
import tempfile
import unittest
from pathlib import Path
from anomaly import analyze, feature


class AnomalyHistoryTests(unittest.TestCase):
    def current(self):
        return {'schemaVersion': '1', 'runId': 'current', 'startedAt': '2026-10-27T12:00:00Z',
                'sourceHashAfter': 'a', 'inventory': {'sourceHash': 'a'},
                'runtime': [{'id': 'api:GET:/api/v1/products', 'environment': 'http://127.0.0.1:8080',
                             'expected': 'anonymous_denied', 'verdict': 'passed', 'durationMs': 10, 'responseBytes': 100}]}

    def test_empty_history_never_trains_or_invents_observations(self):
        with tempfile.TemporaryDirectory() as directory:
            result = analyze(self.current(), Path(directory))
        self.assertEqual(result['status'], 'insufficient_history')
        self.assertEqual(result['checks'][0]['historicalRuns'], 0)
        self.assertIsNone(result['checks'][0]['anomaly'])
        self.assertFalse(result['canOverrideVerification'])

    def test_future_failed_and_different_environment_samples_are_not_baseline(self):
        with tempfile.TemporaryDirectory() as directory:
            for index in range(3):
                value = self.current()
                value.update(runId=str(index), completedAt='2026-10-27T11:00:00Z')
                if index == 0:
                    value['completedAt'] = '2026-10-27T13:00:00Z'
                elif index == 1:
                    value['runtime'][0]['verdict'] = 'failed'
                else:
                    value['runtime'][0]['environment'] = 'http://127.0.0.1:9090'
                folder = Path(directory) / str(index)
                folder.mkdir()
                (folder / 'report.json').write_text(json.dumps(value), encoding='utf-8')
            result = analyze(self.current(), Path(directory))
        self.assertEqual(result['checks'][0]['historicalRuns'], 0)

    def test_source_drift_and_invalid_metrics_are_not_scorable(self):
        value = self.current()
        value['sourceHashAfter'] = 'b'
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(analyze(value, Path(directory))['status'], 'source_changed_during_run')
        self.assertIsNone(feature({'durationMs': float('nan'), 'responseBytes': 1}))
        self.assertIsNone(feature({'durationMs': -1, 'responseBytes': 1}))


if __name__ == '__main__':
    unittest.main()
