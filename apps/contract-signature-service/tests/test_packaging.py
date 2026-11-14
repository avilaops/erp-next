from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

from helpers import ROOT


class WheelCorpusTests(unittest.TestCase):
    def test_test_helpers_cannot_replace_a_selected_wheel_with_checkout_source(self):
        with tempfile.TemporaryDirectory() as directory:
            wheel = Path(directory)/'synthetic_test_package.whl'
            with zipfile.ZipFile(wheel, 'w') as archive:
                archive.writestr('contract_signature_service/__init__.py', '"""SYNTHETIC TEST PACKAGE ONLY"""')
            helper = ROOT/'apps/contract-signature-service/tests/helpers.py'
            code = ('import runpy,sys,importlib.util,zipimport;'
                    f'sys.path.insert(0,{str(wheel)!r});runpy.run_path({str(helper)!r});'
                    'spec=importlib.util.find_spec("contract_signature_service");'
                    'assert isinstance(spec.loader,zipimport.zipimporter),"test helper replaced wheel with source"')
            result = subprocess.run([sys.executable, '-I', '-c', code], capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
