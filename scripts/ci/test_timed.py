import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('timed.py')


class TimedTests(unittest.TestCase):
    def execute(self, command):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'times.jsonl'
            environment = {key: value for key, value in os.environ.items() if key != 'GITHUB_STEP_SUMMARY'}
            result = subprocess.run([sys.executable, str(SCRIPT), '--label', 'Teste', '--output', str(output), '--', *command], capture_output=True, text=True, env=environment)
            records = [json.loads(line) for line in output.read_text().splitlines()] if output.exists() else []
            return result, records

    def test_records_real_duration_without_storing_command_arguments(self):
        result, records = self.execute([sys.executable, '-c', 'pass', 'sensitive-fixture-not-to-store'])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['label'], 'Teste')
        self.assertGreater(records[0]['durationSeconds'], 0)
        self.assertNotIn('sensitive-fixture', json.dumps(records))

    def test_preserves_failed_script_exit_status_and_records_time(self):
        result, records = self.execute([sys.executable, '-c', 'raise SystemExit(7)'])
        self.assertEqual(result.returncode, 7)
        self.assertEqual(records[0]['exitCode'], 7)

    def test_missing_executable_is_reported_without_losing_the_measurement(self):
        result, records = self.execute(['erp-test-command-does-not-exist'])
        self.assertEqual(result.returncode, 127)
        self.assertEqual(records[0]['exitCode'], 127)


if __name__ == '__main__': unittest.main()
