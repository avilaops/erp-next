"""Capture in an exclusive CI job, at the same path as the cached compilation."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
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
    root = Path.cwd()
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise ValueError("CAPTURE_REQUIRES_EXCLUSIVE_CI_JOB")
    event_base = sys.argv[1]
    if not re.fullmatch(r"[0-9a-f]{40}", event_base) or git(root, "rev-parse", f"{event_base}^{{commit}}") != event_base:
        raise ValueError("BASELINE_REQUIRES_COMMIT_SHA")
    revision = git(root, "rev-parse", "HEAD")
    if git(root, "status", "--porcelain", "--untracked-files=no"):
        raise ValueError("DIRTY_CANDIDATE")
    base = event_base
    initial = False
    bootstrap_file = root / "scripts/contracts/initial-baseline.json"
    if bootstrap_file.exists():
        bootstrap = json.loads(bootstrap_file.read_text())
        has_gate = subprocess.run(["git", "cat-file", "-e", f"{event_base}:scripts/contracts/gate.mjs"],
                                  cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
        if not has_gate:
            if bootstrap["eventBaseRevision"] != event_base:
                raise ValueError("UNREVIEWED_INITIAL_BASELINE")
            base = bootstrap["initialBaselineRevision"]
            if not re.fullmatch(r"[0-9a-f]{40}", base) or git(root, "rev-parse", f"{base}^{{commit}}") != base:
                raise ValueError("INVALID_INITIAL_BASELINE")
            if subprocess.run(["git", "merge-base", "--is-ancestor", base, revision], cwd=root).returncode != 0:
                raise ValueError("INITIAL_BASELINE_OUTSIDE_CANDIDATE_HISTORY")
            initial = True
    output = root / "artifacts/contracts"
    output.mkdir(parents=True, exist_ok=True)
    helper = root / "apps/api/src/http/openapi_export.rs"
    helper_bytes = helper.read_bytes()
    manifest = {"schemaVersion": "erp-openapi-capture/1", "eventBaseRevision": event_base,
                "baselineRevision": base, "initialContract": initial, "historicalCompatibilityVerified": not initial,
                "candidateRevision": revision, "helperSha256": hashlib.sha256(helper_bytes).hexdigest(),
                "baselineInstrumented": False, "baselineSources": sources(root, base),
                "eventBaseSources": sources(root, event_base), "candidateSources": sources(root, revision), "captures": []}
    baseline_source = root / "apps/api/src/http/openapi.rs"
    original = None
    created_helper = False
    try:
        run(["git", "checkout", "--detach", base], root)
        original = baseline_source.read_bytes()
        if b'include!("openapi_export.rs")' not in original:
            if helper.exists():
                raise ValueError("AMBIGUOUS_BASELINE_HELPER")
            helper.write_bytes(helper_bytes)
            created_helper = True
            baseline_source.write_bytes(original + b'\n#[cfg(test)]\ninclude!("openapi_export.rs");\n')
            manifest["baselineInstrumented"] = True
        destination = output / "baseline.json"
        if destination.exists():
            raise ValueError("ARTIFACT_ALREADY_EXISTS")
        started = time.monotonic()
        environment = dict(os.environ)
        environment.pop("ERP_COMPANY_CONTRACT_OUTPUT", None)
        run(["cargo", "test", "--locked", "-p", "erp-next-api", "export_openapi_contract_artifact", "--", "--test-threads=1"],
            root, env={**environment, "ERP_OPENAPI_OUTPUT": str(destination)})
        manifest["captures"].append({"label": "baseline", "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
                                     "seconds": round(time.monotonic() - started, 3)})
    finally:
        if original is not None:
            baseline_source.write_bytes(original)
        if created_helper:
            helper.unlink()
        run(["git", "checkout", "--detach", revision], root)
    manifest["captures"].append({"label": "candidate", "sha256": hashlib.sha256((output / "candidate.json").read_bytes()).hexdigest(),
                                 "producer": "candidate Rust test job"})
    (output / "capture.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
