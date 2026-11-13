"""Protect complete web validation and exact build reuse across parallel jobs."""
from pathlib import Path
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[2]


class WebShardTests(unittest.TestCase):
    def setUp(self):
        self.workflow = yaml.safe_load((ROOT / '.github/workflows/_validate-web.yml').read_text())
        self.jobs = self.workflow['jobs']

    def runs(self, name):
        return '\n'.join(step.get('run', '') for step in self.jobs[name]['steps'])

    def test_publication_waits_for_build_and_both_browser_shards(self):
        self.assertEqual(set(self.jobs), {'web', 'browser', 'image'})
        self.assertEqual(self.jobs['browser']['needs'], ['web'])
        self.assertEqual(self.jobs['browser']['if'], 'inputs.full')
        self.assertEqual(self.jobs['browser']['strategy']['matrix']['shard'], [1, 2])
        self.assertFalse(self.jobs['browser']['strategy']['fail-fast'])
        self.assertEqual(set(self.jobs['image']['needs']), {'web', 'browser'})
        self.assertEqual(self.jobs['image']['if'], 'inputs.publish')
        trigger = self.workflow.get('on', self.workflow.get(True))
        self.assertEqual(trigger['workflow_call']['outputs']['digest']['value'], '${{ jobs.image.outputs.digest }}')

    def test_quick_ci_and_build_keep_existing_validations(self):
        self.assertNotIn('if', self.jobs['web'])
        for command in ('pnpm --filter web lint', 'tests/*-model.node.mjs',
                        'generate-web.mjs', 'pnpm --filter web build',
                        'tsc --noEmit', 'build-validation-template.mjs'):
            self.assertIn(command, self.runs('web'))
        self.assertNotIn('test:danfe', self.runs('web'))
        self.assertIn('template_artifact_name', self.jobs['web']['outputs'])

    def test_complete_browser_coverage_is_partitioned_once(self):
        self.assertIn('test:danfe --shard=${{ matrix.shard }}/2', self.runs('browser'))
        commands = {'test:monitor': 1, 'playwright.session.config.ts': 1,
                    'playwright.registry.config.ts': 2, 'playwright.proposals.config.ts': 2}
        for command, shard in commands.items():
            steps = [step for step in self.jobs['browser']['steps'] if command in step.get('run', '')]
            self.assertEqual(len(steps), 1, command)
            self.assertEqual(steps[0]['if'], f'matrix.shard == {shard}')
        self.assertIn('ip_local_reserved_ports=33118-33120,33128-33130,33928-33929,33941', self.runs('browser'))

    def test_build_artifact_preserves_docker_inputs_and_exact_producer_attempt(self):
        build_name = self.jobs['web']['outputs']['build_artifact_name']
        uploads = [step for step in self.jobs['web']['steps'] if step.get('uses', '').startswith('actions/upload-artifact@')]
        build = next(step for step in uploads if step['with']['name'] == build_name)
        self.assertEqual(build['if'], 'inputs.full')
        self.assertEqual(build['with']['retention-days'], 1)
        self.assertTrue(build['with']['include-hidden-files'])
        self.assertIn('github.run_attempt', build_name)
        self.assertIn("--exclude='apps/web/.next/cache'", self.runs('web'))
        self.assertIn('apps/web/.next apps/web/public', self.runs('web'))
        for job in ('browser', 'image'):
            downloads = [step for step in self.jobs[job]['steps'] if step.get('uses', '').startswith('actions/download-artifact@')]
            self.assertEqual([step['with']['name'] for step in downloads], ['${{ needs.web.outputs.build_artifact_name }}'])
            self.assertIn('tar -xzf artifacts/web-build.tar.gz', self.runs(job))

    def test_failure_evidence_and_timing_artifacts_are_unique_per_shard(self):
        for job in self.jobs.values():
            for step in job['steps']:
                if 'run' in step:
                    self.assertIn('scripts/ci/timed.py', step['run'])
        uploads = [step for step in self.jobs['browser']['steps'] if step.get('uses', '').startswith('actions/upload-artifact@')]
        self.assertEqual(len(uploads), 2)
        for step in uploads:
            self.assertEqual(step['if'], 'always()')
            self.assertIn('matrix.shard', step['with']['name'])
            self.assertEqual(step['with']['retention-days'], 7)
        self.assertTrue(any('artifacts/danfe-browser/' in step['with']['path'] for step in uploads))


if __name__ == '__main__':
    unittest.main()
