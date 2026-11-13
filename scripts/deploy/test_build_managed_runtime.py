import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('runtime_build', ROOT / 'deploy/cloudflare/build-runtime.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
SHA = 'a' * 40


def manifest():
    return {'schema': 'erp-release/1', 'sourceSha': SHA, 'images': {
        name: f'ghcr.io/avilaops/erp-next-{name}@sha256:' + str(i) * 64
        for i, name in enumerate(('api', 'web', 'fiscal', 'fiscal-mcp'), 1)}}


class BuildTests(unittest.TestCase):
    def test_plan_validates_existing_release_protocol_without_docker_or_private_context(self):
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            return subprocess.CompletedProcess(args, 0, b'// reviewed source\n', b'')
        value = builder.build_runtime(manifest(), SHA, ROOT, run=run)
        self.assertFalse(value['built'])
        self.assertEqual(value['contextFiles'], list(builder.CONTEXT_FILES))
        self.assertTrue(all(args[:2] == ['git', 'show'] for args in calls))
        self.assertEqual(value['applicationSourceSha'], SHA)

    def test_wrong_source_foreign_registry_and_mutable_tags_are_rejected_before_execution(self):
        for change in ('source', 'tag', 'registry'):
            value = manifest()
            if change == 'source': value['sourceSha'] = 'b' * 40
            if change == 'tag': value['images']['api'] = 'ghcr.io/avilaops/erp-next-api:latest'
            if change == 'registry': value['images']['api'] = value['images']['api'].replace('avilaops', 'foreign')
            with self.subTest(change=change), self.assertRaises(ValueError):
                builder.build_runtime(value, SHA, ROOT, run=lambda *a, **k: self.fail('must reject before Git/Docker'))

    def test_build_context_contains_only_three_exact_git_files_and_never_pushes(self):
        contexts = []
        def run(args, **kwargs):
            if args[:2] == ['git', 'show']:
                return subprocess.CompletedProcess(args, 0, b'// fixture\n', b'')
            self.assertEqual(args[:2], ['docker', 'build'])
            self.assertNotIn('push', args)
            context = Path(args[-1])
            contexts.append(context)
            files = sorted(str(p.relative_to(context)).replace('\\', '/') for p in context.rglob('*') if p.is_file())
            self.assertEqual(files, sorted(builder.CONTEXT_FILES))
            self.assertTrue(all(p.read_bytes() == b'// fixture\n' for p in context.rglob('*') if p.is_file()))
            return subprocess.CompletedProcess(args, 0, b'', b'')
        proof = builder.build_runtime(manifest(), SHA, ROOT, execute=True, run=run)
        self.assertTrue(proof['built'])
        self.assertFalse(proof['published'])
        self.assertFalse(any(path.exists() for path in contexts))

    def test_failed_git_or_build_cannot_be_reported_as_success(self):
        for failure in ('git', 'docker'):
            def run(args, **kwargs):
                return subprocess.CompletedProcess(args, int(args[0] == failure), b'content', b'private registry error')
            with self.subTest(failure=failure), self.assertRaises(ValueError):
                builder.build_runtime(manifest(), SHA, ROOT, execute=True, run=run)


if __name__ == '__main__':
    unittest.main()
