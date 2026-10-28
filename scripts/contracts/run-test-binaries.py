"""Verify same-revision artifacts and run all Rust tests, only on GitHub CI."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

if os.environ.get("GITHUB_ACTIONS") != "true":
    raise ValueError("TEST_EXECUTION_REQUIRES_CI")
root = Path.cwd()
directory = root / "artifacts/rust-tests"
manifest = json.loads((directory / "manifest.json").read_text())
revision = subprocess.check_output(["git", "rev-parse", "HEAD"]).decode().strip()
if manifest["schemaVersion"] != "erp-test-binaries/1" or manifest["revision"] != revision or not manifest["executables"]:
    raise ValueError("TEST_ARTIFACT_REVISION_MISMATCH")
(root / "artifacts/contracts").mkdir(parents=True, exist_ok=True)
for executable in manifest["executables"]:
    if Path(executable["file"]).name != executable["file"]:
        raise ValueError("INVALID_TEST_ARTIFACT_PATH")
    file = directory / executable["file"]
    if file.is_symlink() or hashlib.sha256(file.read_bytes()).hexdigest() != executable["sha256"]:
        raise ValueError("TEST_ARTIFACT_HASH_MISMATCH")
    file.chmod(0o700)
    environment = {**os.environ, "ERP_OPENAPI_OUTPUT": str(root / "artifacts/contracts/candidate.json"),
                   "ERP_COMPANY_CONTRACT_OUTPUT": str(root / "artifacts/contracts/company.json")}
    subprocess.run([str(file), "--test-threads=4"], cwd=root / "apps/api", env=environment, check=True)
