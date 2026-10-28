"""CI-only capture from explicit Git revisions; never start application services."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time


def run(arguments, cwd, **kwargs):
    return subprocess.run(arguments, cwd=cwd, check=True, **kwargs)


def git(root, *arguments):
    return subprocess.check_output(["git", *arguments], cwd=root).decode().strip()


def sources(root, revision):
    names = git(root, "ls-tree", "-r", "--name-only", revision, "Cargo.toml", "Cargo.lock",
                "rust-toolchain.toml", "apps/api", "migrations").splitlines()
    return [{"path": name, "sha256": hashlib.sha256(
        subprocess.check_output(["git", "show", f"{revision}:{name}"], cwd=root)).hexdigest()}
        for name in names]


def main():
    root = Path(__file__).resolve().parents[2]
    base = sys.argv[1]
    if not re.fullmatch(r"[0-9a-f]{40}", base) or git(root, "rev-parse", f"{base}^{{commit}}") != base:
        raise ValueError("BASELINE_REQUIRES_COMMIT_SHA")
    revision = git(root, "rev-parse", "HEAD")
    if git(root, "status", "--porcelain", "--untracked-files=no"):
        raise ValueError("DIRTY_CANDIDATE")
    output = root / "artifacts/contracts"
    output.mkdir(parents=True, exist_ok=True)
    helper = root / "apps/api/src/http/openapi_export.rs"
    helper_bytes = helper.read_bytes()
    include = '\n#[cfg(test)]\ninclude!("openapi_export.rs");\n'
    manifest = {"schemaVersion": "erp-openapi-capture/1", "baselineRevision": base,
                "candidateRevision": revision, "helperSha256": hashlib.sha256(helper_bytes).hexdigest(),
                "baselineInstrumented": False, "baselineSources": sources(root, base),
                "candidateSources": sources(root, revision), "captures": []}
    environment = dict(os.environ)
    environment.pop("ERP_COMPANY_CONTRACT_OUTPUT", None)
    environment["CARGO_TARGET_DIR"] = str(root / "target")
    with tempfile.TemporaryDirectory(prefix="erp-openapi-base-") as temporary:
        baseline = Path(temporary) / "checkout"
        run(["git", "worktree", "add", "--detach", str(baseline), base], root)
        try:
            baseline_source = baseline / "apps/api/src/http/openapi.rs"
            original = baseline_source.read_text()
            if 'include!("openapi_export.rs")' not in original:
                baseline_source.write_text(original + include)
                (baseline_source.parent / helper.name).write_bytes(helper_bytes)
                manifest["baselineInstrumented"] = True
            for label, checkout in [("baseline", baseline), ("candidate", root)]:
                destination = output / f"{label}.json"
                if destination.exists():
                    raise ValueError("ARTIFACT_ALREADY_EXISTS")
                started = time.monotonic()
                run(["cargo", "test", "--locked", "-p", "erp-next-api", "export_openapi_contract_artifact", "--", "--test-threads=1"],
                    checkout, env={**environment, "ERP_OPENAPI_OUTPUT": str(destination)})
                manifest["captures"].append({"label": label, "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
                                             "seconds": round(time.monotonic() - started, 3)})
        finally:
            run(["git", "worktree", "remove", "--force", str(baseline)], root)
    (output / "capture.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
