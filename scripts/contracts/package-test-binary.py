"""Package exactly the test executables Cargo reported, with hashes for the next CI job."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

output = Path("artifacts/rust-tests")
metadata = json.loads(subprocess.check_output(["cargo", "metadata", "--locked", "--no-deps", "--format-version=1"]))
members = set(metadata["workspace_members"])
for package in metadata["packages"]:
    if package["id"] in members and any(target["kind"] != ["bin"] for target in package["targets"]):
        raise ValueError("NEW_WORKSPACE_TARGET_REQUIRES_REVIEW_OF_TEST_AND_DOCTEST_PACKAGING")
output.mkdir(parents=True, exist_ok=False)
executables = []
for line in Path("artifacts/rust-build.jsonl").read_text().splitlines():
    value = json.loads(line)
    if value.get("reason") == "compiler-artifact" and value.get("profile", {}).get("test") and value.get("executable"):
        source = Path(value["executable"])
        destination = output / source.name
        shutil.copyfile(source, destination)
        subprocess.run(["strip", "--strip-debug", str(destination)], check=True)
        executables.append({"file": destination.name, "sha256": hashlib.sha256(destination.read_bytes()).hexdigest()})
if not executables:
    raise ValueError("NO_COMPILED_TEST_EXECUTABLES")
revision = subprocess.check_output(["git", "rev-parse", "HEAD"]).decode().strip()
(output / "manifest.json").write_text(json.dumps({"schemaVersion": "erp-test-binaries/1", "revision": revision, "executables": executables}, indent=2))
