"""Structural checks for the public CI/release entry points and their reusable jobs."""
from pathlib import Path
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[2]


class WorkflowTests(unittest.TestCase):
    def test_private_signature_service_requires_linux_docker_in_existing_policy_job(self):
        policy = self.workflows()['_validate-project.yml']['jobs']['policy']
        step = next((s for s in policy['steps'] if s.get('name') == 'Verify private signature service'), None)
        self.assertIsNotNone(step)
        self.assertEqual(step['if'], "steps.signature_scope.outputs.required == 'true'")
        self.assertIn('uv sync --frozen --project apps/contract-signature-service', step['run'])
        self.assertIn('verify-signature-service.py', step['run'])
        self.assertIn('--docker', step['run'])
        self.assertNotIn('continue-on-error', step)
        self.assertGreaterEqual(policy['timeout-minutes'], 15)

    def test_signature_core_is_verified_conditionally_in_the_shared_policy_job(self):
        self.assertTrue((ROOT / 'apps/contract-signature-validator/pyproject.toml').is_file())
        steps = self.workflows()['_validate-project.yml']['jobs']['policy']['steps']
        scope = next(step for step in steps if step.get('id') == 'signature_scope')
        self.assertIn("hashFiles('apps/contract-signature-validator/pyproject.toml')", scope['if'])
        self.assertIn('pr-gate.py signatures', scope['run'])
        verify = next(step for step in steps if step.get('name') == 'Verify isolated signature core')
        self.assertEqual(verify['if'], "steps.signature_scope.outputs.required == 'true'")
        self.assertIn('uv sync --frozen', verify['run'])
        self.assertIn('verify-signature-validator.py', verify['run'])
        self.assertIn('uv build', verify['run'])
        checkout = next(step for step in steps if step.get('uses', '').startswith('actions/checkout@'))
        self.assertEqual(checkout['with']['fetch-depth'], 2)

    def workflows(self):
        return {p.name: yaml.safe_load(p.read_text()) for p in (ROOT / '.github/workflows').glob('*.yml')}

    def triggers(self, workflow):
        # PyYAML implements YAML 1.1, where the plain key 'on' is a boolean.
        return workflow.get('on', workflow.get(True, {}))

    def test_only_three_entry_points_and_internal_reusable_workflows(self):
        files = self.workflows()
        self.assertEqual({name for name in files if not name.startswith('_')}, {'ci.yml', 'release.yml', 'regression.yml'})
        for name, workflow in files.items():
            if name.startswith('_'):
                self.assertEqual(set(self.triggers(workflow)), {'workflow_call'})

    def test_pr_validation_cannot_publish_or_access_production(self):
        ci = self.workflows()['ci.yml']
        self.assertIn('pull_request', self.triggers(ci))
        self.assertNotIn('push', self.triggers(ci))
        self.assertIn('gate', ci['jobs'])
        for job in ci['jobs'].values():
            self.assertNotIn('environment', job)
            self.assertNotEqual(job.get('with', {}).get('publish'), True)

    def test_release_is_explicit_and_deployment_is_serialized(self):
        release = self.workflows()['release.yml']
        triggers = self.triggers(release)
        self.assertNotIn('branches', triggers.get('push', {}))
        self.assertEqual(triggers['push']['tags'], ['v*'])
        self.assertIn('workflow_dispatch', triggers)
        self.assertFalse(release['concurrency']['cancel-in-progress'])
        deploy = release['jobs']['deploy']
        self.assertEqual(deploy['environment'], 'production')
        self.assertIn('evidence', deploy['needs'])

    def test_regression_has_no_production_deployment(self):
        workflow = self.workflows()['regression.yml']
        self.assertIn('schedule', self.triggers(workflow))
        self.assertNotIn('push', self.triggers(workflow))
        self.assertNotIn('pull_request', self.triggers(workflow))
        for job in workflow['jobs'].values():
            self.assertNotIn('environment', job)
            self.assertNotEqual(job.get('with', {}).get('publish'), True)

    def test_artifacts_have_expiration_and_no_image_archives_are_sent(self):
        for name, workflow in self.workflows().items():
            for job in workflow['jobs'].values():
                for step in job.get('steps', []):
                    if step.get('uses', '').startswith('actions/upload-artifact@'):
                        self.assertIn('retention-days', step['with'], (name, step))
                        self.assertLessEqual(step['with']['retention-days'], 30)
                    self.assertNotIn('docker save', step.get('run', ''), name)

    def test_reusable_references_resolve(self):
        for workflow in self.workflows().values():
            for job in workflow['jobs'].values():
                if job.get('uses', '').startswith('./'):
                    self.assertTrue((ROOT / job['uses'][2:]).is_file(), job['uses'])

    def test_contract_consumers_receive_both_rust_exports(self):
        api = self.workflows()['_validate-api.yml']['jobs']['api']
        export = next(step['run'] for step in api['steps'] if step.get('name') == 'Test and export the exact source contract')
        self.assertIn('ERP_OPENAPI_OUTPUT=', export)
        self.assertIn('ERP_COMPANY_CONTRACT_OUTPUT=', export)
        paths = [step['with']['path'] for step in api['steps']
                 if step.get('uses', '').startswith('actions/upload-artifact@')
                 and step['with']['name'].startswith('erp-openapi-')]
        for contract in ('candidate.json', 'company.json'):
            self.assertTrue(any(path.rstrip('/') == 'artifacts/contracts'
                                or f'artifacts/contracts/{contract}' in path.splitlines()
                                for path in paths), f'{contract} is missing from the shared contract artifact')

    def test_architecture_is_checked_before_release_builds_and_in_pr(self):
        files = self.workflows()
        for filename, jobname in (('_validate-project.yml', 'policy'), ('release.yml', 'select')):
            steps = files[filename]['jobs'][jobname]['steps']
            self.assertTrue(any('pnpm check:architecture' in step.get('run', '') for step in steps),
                            f'{filename}/{jobname} does not validate the actual source architecture')
        select = files['release.yml']['jobs']['select']
        self.assertTrue(any(step.get('with', {}).get('ref') == '${{ steps.source.outputs.sha }}'
                            for step in select['steps']), 'Preflight must inspect the selected revision')

    def test_yaml_has_literal_on_key_and_unique_artifact_names(self):
        names = []
        for path in (ROOT / '.github/workflows').glob('*.yml'):
            self.assertIn('on', yaml.load(path.read_text(), Loader=yaml.BaseLoader), path.name)
        for workflow in self.workflows().values():
            for job in workflow['jobs'].values():
                for step in job.get('steps', []):
                    if step.get('uses', '').startswith('actions/upload-artifact@'):
                        names.append(step['with']['name'])
        self.assertEqual(len(names), len(set(names)), 'Two producers have the same artifact name')

    def test_partial_retries_use_producer_artifact_names(self):
        files = self.workflows()
        for filename, jobname, producer in (
            ('release.yml', 'deploy', 'needs.evidence.outputs.manifest_artifact_name'),
            ('_validate-web.yml', 'web', 'inputs.openapi_artifact_name'),
            ('_validate-project.yml', 'baseline', 'inputs.openapi_artifact_name'),
            ('_validate-project.yml', 'contracts', 'needs.baseline.outputs.contract_artifact_name'),
        ):
            steps = files[filename]['jobs'][jobname]['steps']
            names = [step['with']['name'] for step in steps if step.get('uses', '').startswith('actions/download-artifact@')]
            self.assertEqual(names, ['${{ ' + producer + ' }}'])


if __name__ == '__main__': unittest.main()
