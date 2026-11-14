import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
import json
from types import SimpleNamespace
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('signature_service_verifier',
    ROOT/'scripts/contracts/verify-signature-service.py')
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class ServiceArchiveTests(unittest.TestCase):
    def archives(self, root, extra=None, *, in_sdist=False):
        wheel = root/'test.whl'
        with zipfile.ZipFile(wheel, 'w') as archive:
            archive.writestr('contract_signature_service/launcher.py', '"""SYNTHETIC ARCHIVE TEST"""')
            if extra is not None and not in_sdist: archive.writestr(extra, b'fixture')
        with tarfile.open(root/'test.tar.gz', 'w:gz') as archive:
            name = extra if in_sdist else 'test/README.md'
            info = tarfile.TarInfo(name)
            info.size = 7
            archive.addfile(info, io.BytesIO(b'fixture'))
        return wheel

    def test_archive_coverage_rejects_keys_fixtures_and_virtualenvs_in_either_distribution(self):
        for name in ('test/tests/fixture.py', 'test/.venv/pyvenv.cfg', 'test/private.key',
                     'test/personal.p12', 'test/chain.pem', 'test/__pycache__/a.pyc'):
            for in_sdist in (False, True):
                with self.subTest(name=name, sdist=in_sdist), tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    self.archives(root, name, in_sdist=in_sdist)
                    with self.assertRaises(ValueError): verifier.verify_archives(root)

    def test_runtime_entrypoint_must_be_present_and_clean_pair_is_accepted(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            wheel = self.archives(root)
            self.assertEqual(verifier.verify_archives(root), wheel)
            with zipfile.ZipFile(wheel, 'w') as archive: archive.writestr('placeholder.py', b'')
            with self.assertRaises(ValueError): verifier.verify_archives(root)


class OwnedDockerCleanupTests(unittest.TestCase):
    def test_foreign_or_missing_resource_is_never_deleted(self):
        for details in ([], [{'Config': {'Labels': {'avilaops.validator-ci': 'foreign'}}}]):
            inspect = SimpleNamespace(returncode=0, stdout=json.dumps(details))
            with patch.object(verifier.subprocess, 'run', return_value=inspect) as run:
                verifier.remove_owned('container', 'generated-name', 'our-token')
                self.assertEqual(run.call_count, 1)

    def test_own_resource_deletion_is_exact_and_uses_no_prune(self):
        details = [{'Labels': {'avilaops.validator-ci': 'our-token'}}]
        inspect = SimpleNamespace(returncode=0, stdout=json.dumps(details))
        with patch.object(verifier.subprocess, 'run', return_value=inspect) as run:
            verifier.remove_owned('volume', 'generated-volume', 'our-token')
            self.assertEqual(run.call_args_list[-1].args[0], ['docker', 'volume', 'rm', 'generated-volume'])
