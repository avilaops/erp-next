import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import os
import time
import unittest


MODULE = Path(__file__).resolve().parents[2] / 'deploy' / 'release-retention.py'
spec = importlib.util.spec_from_file_location('release_retention', MODULE)
retention = importlib.util.module_from_spec(spec)
if MODULE.exists():
    spec.loader.exec_module(retention)

A, B, C = ('a' * 40, 'b' * 40, 'c' * 40)
COMPONENTS = ('api', 'web', 'fiscal', 'fiscal-mcp')


def manifest(sha, digit='a'):
    return {'schema': 'erp-release/1', 'sourceSha': sha,
            'images': {name: f'ghcr.io/avilaops/erp-next-{name}@sha256:{digit * 64}' for name in COMPONENTS}}


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / 'releases').mkdir()

    def release(self, sha, digit='a'):
        directory = self.root / 'releases' / sha
        directory.mkdir()
        (directory / 'release.json').write_text(json.dumps(manifest(sha, digit)))
        return directory

    def test_manifest_requires_exact_components_owned_registry_and_digests(self):
        self.assertEqual(retention.validate_manifest(manifest(A), A)['sourceSha'], A)
        mutations = [lambda x: x.update(sourceSha=B), lambda x: x['images'].pop('api'),
                     lambda x: x['images'].update(other='foreign:latest'),
                     lambda x: x['images'].update(api='ghcr.io/another/app@sha256:' + 'a' * 64),
                     lambda x: x['images'].update(api='ghcr.io/avilaops/erp-next-api:latest')]
        for mutate in mutations:
            value = manifest(A)
            mutate(value)
            with self.assertRaises(ValueError):
                retention.validate_manifest(value, A)

    def test_dry_run_preserves_active_rollback_and_does_not_delete_anything(self):
        for sha in (A, B, C): self.release(sha)
        plan = retention.directory_plan(self.root, A, B)
        self.assertEqual(plan, [self.root / 'releases' / C])
        self.assertTrue(all((self.root / 'releases' / sha).exists() for sha in (A, B, C)))

    def test_only_owned_sha_directories_are_candidates(self):
        self.release(A)
        self.release(B)
        self.release(C)
        foreign = self.root / 'releases' / 'customer-uploads'
        foreign.mkdir()
        self.assertEqual(retention.directory_plan(self.root, A, B), [self.root / 'releases' / C])

    def test_unknown_release_without_a_managed_manifest_is_preserved(self):
        self.release(A)
        self.release(B)
        (self.root / 'releases' / C).mkdir()
        self.assertEqual(retention.directory_plan(self.root, A, B), [])

    def test_missing_protected_release_aborts_instead_of_guessing(self):
        self.release(A)
        with self.assertRaises(ValueError): retention.directory_plan(self.root, A, B)

    def test_image_selection_protects_rollback_shared_and_container_references(self):
        images = [
            {'Id': 'active', 'RepoTags': ['erp-next-api:sha-' + A], 'RepoDigests': []},
            {'Id': 'rollback', 'RepoTags': ['erp-next-api:sha-' + B], 'RepoDigests': []},
            {'Id': 'old', 'RepoTags': ['erp-next-api:sha-' + C], 'RepoDigests': []},
            {'Id': 'shared', 'RepoTags': ['erp-next-api:sha-' + C, 'another-app:latest'], 'RepoDigests': []},
            {'Id': 'busy', 'RepoTags': ['erp-next-web:sha-' + C], 'RepoDigests': []},
        ]
        self.assertEqual(retention.image_candidates(images, {'active', 'rollback', 'busy'}), ['old'])

    def test_symlinked_release_root_is_rejected(self):
        original = self.root / 'releases'
        original.rename(self.root / 'outside')
        try: original.symlink_to(self.root / 'outside', target_is_directory=True)
        except OSError: self.skipTest('Symlinks unavailable for this account')
        with self.assertRaises(ValueError): retention.directory_plan(self.root, A, B)

    def test_no_global_prune_or_volume_deletion_in_deployment_code(self):
        for name in ('release-retention.py', 'production-deploy.sh'):
            text = (MODULE.parent / name).read_text()
            self.assertNotIn('system prune', text)
            self.assertNotIn('volume prune', text)

    def test_old_abandoned_staging_is_selected_but_fresh_or_unknown_directories_are_preserved(self):
        old = self.root / '.incoming.ABC123'
        old.mkdir()
        (old / 'api-image.tar.gz').write_text('synthetic')
        stale = time.time() - 90000
        os.utime(old, (stale, stale))
        fresh = self.root / '.incoming.DEF456'
        fresh.mkdir()
        (fresh / 'release.json').write_text('{}')
        foreign = self.root / '.incoming.GHI789'
        foreign.mkdir()
        (foreign / 'customer-data').write_text('preserve')
        os.utime(foreign, (stale, stale))
        self.assertEqual(retention.staging_plan(self.root), [old])

    def test_apply_removes_only_stale_releases_and_keeps_container_directory_and_images(self):
        self.release(A)
        self.release(B, 'b')
        self.release(C, 'c')
        containers = [{'Image': 'busy-image', 'Config': {'Labels': {'com.docker.compose.project.working_dir': str(self.root / 'releases' / C)}}}]
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            tail = args[1:]
            if tail[:3] == ['container', 'ls', '--all']: out = 'container-id'
            elif tail[:2] == ['container', 'inspect']: out = json.dumps(containers)
            elif tail[:2] == ['image', 'inspect'] and '--format' in tail: out = 'protected-image'
            elif tail[:2] == ['image', 'ls']: out = 'old-image\nprotected-image\nbusy-image'
            elif tail[:2] == ['image', 'inspect']:
                out = json.dumps([{'Id': 'old-image', 'RepoTags': ['erp-next-api:sha-' + C], 'RepoDigests': []},
                                  {'Id': 'protected-image', 'RepoTags': ['erp-next-api:sha-' + A], 'RepoDigests': []},
                                  {'Id': 'busy-image', 'RepoTags': ['erp-next-web:sha-' + C], 'RepoDigests': []}])
            else: out = ''
            return subprocess.CompletedProcess(args, 0, out, '')
        report = retention.cleanup(self.root, A, B, apply=True, run=run)
        self.assertTrue((self.root / 'releases' / C).exists(), 'A container still references this directory')
        self.assertEqual(report['releases'], [])
        removed = [args for args in calls if args[1:3] == ['image', 'rm']]
        self.assertEqual(removed, [['docker', 'image', 'rm', '--no-prune', 'erp-next-api:sha-' + C]])
        containers.clear()
        report = retention.cleanup(self.root, A, B, apply=True, run=run)
        self.assertFalse((self.root / 'releases' / C).exists())
        self.assertTrue((self.root / 'releases' / A).exists())
        self.assertTrue((self.root / 'releases' / B).exists())


if __name__ == '__main__': unittest.main()
