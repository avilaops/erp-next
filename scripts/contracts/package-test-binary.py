"""Package exactly the test executables Cargo reported, with hashes for the next CI job."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

output = Path("artifacts/rust-tests")
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
