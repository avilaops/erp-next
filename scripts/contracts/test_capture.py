import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest

from capture import BASELINE_REPAIR, baseline_compilation_repair


class BaselineCaptureTests(unittest.TestCase):
    def fixture(self, root):
        original = subprocess.check_output(["git", "show", f"{BASELINE_REPAIR['revision']}:{BASELINE_REPAIR['path']}"])
        target = root / BASELINE_REPAIR["path"]
        target.parent.mkdir(parents=True)
        target.write_bytes(original)
        return target, original

    def test_exact_instrumentation_and_restore_even_on_export_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target, original = self.fixture(root)
            with self.assertRaisesRegex(RuntimeError, "export failed"):
                with baseline_compilation_repair(root, BASELINE_REPAIR["revision"]) as receipt:
                    self.assertEqual(receipt, BASELINE_REPAIR)
                    self.assertEqual(hashlib.sha256(target.read_bytes()).hexdigest(), BASELINE_REPAIR["afterSha256"])
                    self.assertEqual(target.read_bytes(), original.replace(BASELINE_REPAIR["original"].encode(), BASELINE_REPAIR["replacement"].encode()))
                    raise RuntimeError("export failed")
            self.assertEqual(target.read_bytes(), original)

    def test_other_revision_is_never_patched(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with baseline_compilation_repair(root, "0" * 40) as receipt:
                self.assertIsNone(receipt)
            self.assertEqual(list(root.iterdir()), [])

    def test_modified_historical_source_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target, original = self.fixture(root)
            altered = original + b"\n// changed source\n"
            target.write_bytes(altered)
            with self.assertRaisesRegex(ValueError, "BASELINE_REPAIR_SOURCE_MISMATCH"):
                with baseline_compilation_repair(root, BASELINE_REPAIR["revision"]):
                    self.fail("altered source accepted")
            self.assertEqual(target.read_bytes(), altered)


if __name__ == "__main__":
    unittest.main()
