import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import capture
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


class IdenticalInputsCaptureTests(unittest.TestCase):
    def repository(self, root):
        subprocess.run(["git", "init", "--quiet", str(root)], check=True)
        files = {
            "Cargo.toml": '[workspace]\nmembers = ["apps/api"]\n',
            "Cargo.lock": "version = 4\n",
            "rust-toolchain.toml": '[toolchain]\nchannel = "1.99.1"\n',
            "apps/api/Cargo.toml": '[package]\nname="erp-next-api"\nversion="0.1.0"\n',
            "apps/api/src/http/openapi.rs": 'include!("openapi_export.rs");\n',
            "apps/api/src/http/openapi_export.rs": "// candidate export helper\n",
            "apps/api/src/main.rs": 'const VERSION: &str = env!("CARGO_PKG_VERSION");\n',
            "migrations/001.sql": "SELECT 1;\n",
            ".cargo/config.toml": "[build]\njobs=2\n",
            "queries/example.sql": "SELECT 1;\n",
            "deploy/example.pem": "public fixture\n",
        }
        for name, value in files.items():
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(value)
        return self.commit(root)

    def commit(self, root):
        subprocess.run(["git", "add", "."], cwd=root, check=True)
        subprocess.run(["git", "-c", "user.name=Capture fixture", "-c", "user.email=capture@example.invalid",
                        "commit", "--quiet", "-m", "fixture"], cwd=root, check=True)
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root).decode().strip()

    def candidate(self, root):
        (root / "README.md").write_text("Only non-Rust changes\n")
        return self.commit(root)

    def manifest(self, root, base, revision):
        return {"eventBaseRevision": base, "baselineRevision": base, "candidateRevision": revision,
                "initialContract": False, "baselineInstrumented": False, "historicalCompatibilityVerified": True,
                "baselineSources": capture.sources(root, base), "eventBaseSources": capture.sources(root, base),
                "candidateSources": capture.sources(root, revision), "captures": []}

    def reuse(self, root, manifest, document=None):
        output = root / "artifacts/contracts"
        output.mkdir(parents=True, exist_ok=True)
        candidate = json.dumps(document if document is not None else {
            "openapi": "3.1.0", "info": {"title": "Fixture", "version": "1"},
            "paths": {"/example": {"get": {"responses": {"200": {"description": "ok"}}}}},
        }).encode()
        (output / "candidate.json").write_bytes(candidate)
        reuse = getattr(capture, "reuse_identical_inputs", None)
        self.assertTrue(callable(reuse), "identical Rust inputs should reuse the candidate export")
        return reuse(root, output, manifest), candidate

    def test_same_inputs_copy_exact_bytes_without_checkout_or_cargo(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            base = self.repository(root)
            revision = self.candidate(root)
            manifest = self.manifest(root, base, revision)
            with patch("capture.run", side_effect=AssertionError("checkout/cargo forbidden")):
                reused, candidate = self.reuse(root, manifest)
            self.assertTrue(reused)
            self.assertEqual((root / "artifacts/contracts/baseline.json").read_bytes(), candidate)
            self.assertEqual(manifest["captureMode"], "identical_api_inputs")
            self.assertEqual(manifest["captures"][0]["sha256"], hashlib.sha256(candidate).hexdigest())
            self.assertFalse(manifest["historicalCompatibilityVerified"])

    def test_main_does_not_checkout_or_compile_when_api_inputs_are_identical(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            base = self.repository(root)
            revision = self.candidate(root)
            output = root / "artifacts/contracts"
            output.mkdir(parents=True)
            candidate = b'{"openapi":"3.1.0","info":{"title":"Fixture","version":"1"},"paths":{"/x":{}}}\n'
            (output / "candidate.json").write_bytes(candidate)
            with patch("capture.Path.cwd", return_value=root), patch.dict(os.environ, {"GITHUB_ACTIONS": "true"}), \
                    patch.object(sys, "argv", ["capture.py", base]), \
                    patch("capture.run", side_effect=AssertionError("checkout/cargo forbidden")):
                capture.main()
            manifest = json.loads((output / "capture.json").read_text())
            self.assertEqual(manifest["candidateRevision"], revision)
            self.assertEqual([item["label"] for item in manifest["captures"]], ["baseline", "candidate"])
            self.assertEqual((output / "baseline.json").read_bytes(), candidate)
            self.assertEqual(subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root).decode().strip(), revision)

    def test_existing_baseline_evidence_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            base = self.repository(root)
            revision = self.candidate(root)
            manifest = self.manifest(root, base, revision)
            self.assertTrue(self.reuse(root, manifest)[0])
            baseline = root / "artifacts/contracts/baseline.json"
            baseline.write_bytes(b"preserved evidence")
            with self.assertRaises(FileExistsError):
                self.reuse(root, self.manifest(root, base, revision))
            self.assertEqual(baseline.read_bytes(), b"preserved evidence")

    def test_changed_and_deleted_external_build_inputs_prevent_reuse(self):
        for name in [".cargo/config.toml", "queries/example.sql", "deploy/example.pem", "apps/api/src/main.rs"]:
            for deleted in [False, True]:
                with self.subTest(path=name, deleted=deleted), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    base = self.repository(root)
                    if deleted:
                        (root / name).unlink()
                    else:
                        (root / name).write_text("changed\n")
                    revision = self.commit(root)
                    reused, _ = self.reuse(root, self.manifest(root, base, revision))
                    self.assertFalse(reused)
                    self.assertFalse((root / "artifacts/contracts/baseline.json").exists())

    def test_initial_instrumented_repaired_or_different_baseline_never_reuse(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            base = self.repository(root)
            revision = self.candidate(root)
            for override in [{"initialContract": True}, {"baselineInstrumented": True},
                             {"baselineCompilationRepair": BASELINE_REPAIR}, {"baselineRevision": "0" * 40},
                             {"baselineSources": []}, {"candidateSources": []}, {"eventBaseSources": []}]:
                with self.subTest(override=override):
                    manifest = {**self.manifest(root, base, revision), **override}
                    self.assertFalse(self.reuse(root, manifest)[0])

    def test_invalid_candidate_fails_closed_without_creating_a_baseline(self):
        documents = [[], {"openapi": "3.1.0", "info": {}, "paths": {}},
                     {"openapi": "3.1.0", "info": {"title": "Fixture", "version": "1"},
                      "paths": {"/example": {"$ref": "https://example.invalid/remote.json"}}}]
        for document in documents:
            with self.subTest(document=document), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                base = self.repository(root)
                revision = self.candidate(root)
                with self.assertRaisesRegex(ValueError, "INVALID_OPENAPI"):
                    self.reuse(root, self.manifest(root, base, revision), document)
                self.assertFalse((root / "artifacts/contracts/baseline.json").exists())

    def test_unaccounted_build_script_env_or_include_disables_reuse(self):
        for name, content in [
            ("apps/api/build.rs", 'fn main() {}\n'),
            ("apps/api/src/main.rs", 'const VALUE: &str = env!("UNTRACKED_INPUT");\n'),
            ("apps/api/src/main.rs", 'include!(concat!(env!("OUT_DIR"), "/generated.rs"));\n'),
            ("apps/api/src/main.rs", 'const VALUE: &str = include_str!("../../../README.md");\n'),
            ("apps/api/Cargo.toml", '[package]\nname="erp-next-api"\nversion="1"\n[dependencies]\nlocal={path="../../other"}\n'),
        ]:
            with self.subTest(path=name, content=content), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.repository(root)
                (root / name).write_text(content)
                base = self.commit(root)
                revision = self.candidate(root)
                self.assertFalse(self.reuse(root, self.manifest(root, base, revision))[0])


if __name__ == "__main__":
    unittest.main()
