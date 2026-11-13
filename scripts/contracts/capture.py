"""Capture in an exclusive CI job, at the same path as the cached compilation."""
import hashlib
import io
import json
import os
from pathlib import Path
import posixpath
import re
import subprocess
import sys
import time
from contextlib import contextmanager
from functools import lru_cache
import tomllib


BASELINE_REPAIR = json.loads(Path(__file__).with_name("baseline-1196d52.json").read_text())
INPUT_PATHS = ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "rust-toolchain", ".cargo", ".sqlx",
               "apps/api", "migrations", "queries", "deploy"]


@lru_cache(maxsize=3)
def source_tree(root, revision):
    """Read Git blobs in one batch, including external Rust include!/SQL inputs."""
    listing = subprocess.check_output(["git", "ls-tree", "-r", "-z", revision, "--", *INPUT_PATHS], cwd=root)
    entries = []
    for entry in listing.split(b"\0"):
        if entry:
            metadata, name = entry.split(b"\t", 1)
            mode, kind, oid = metadata.split()
            if kind != b"blob":
                raise ValueError("UNSUPPORTED_API_INPUT")
            entries.append((name.decode(), mode.decode(), oid))
    if not entries:
        return {}
    blobs = io.BytesIO(subprocess.check_output(["git", "cat-file", "--batch"], cwd=root,
                                             input=b"\n".join(row[2] for row in entries) + b"\n"))
    result = {}
    for name, mode, oid in entries:
        header = blobs.readline().split()
        if len(header) != 3 or header[0] != oid or header[1] != b"blob":
            raise ValueError("INVALID_API_INPUT_BLOB")
        content = blobs.read(int(header[2]))
        if blobs.read(1) != b"\n":
            raise ValueError("INVALID_API_INPUT_BLOB")
        result[name] = (mode, content)
    return result


@contextmanager
def baseline_compilation_repair(root, revision):
    """Instrument one non-compiling historical tree; never patch another baseline."""
    if revision != BASELINE_REPAIR["revision"]:
        yield None
        return
    target = root / BASELINE_REPAIR["path"]
    original = target.read_bytes()
    if hashlib.sha256(original).hexdigest() != BASELINE_REPAIR["beforeSha256"]:
        raise ValueError("BASELINE_REPAIR_SOURCE_MISMATCH")
    before = BASELINE_REPAIR["original"].encode()
    if original.count(before) != 1:
        raise ValueError("BASELINE_REPAIR_NOT_UNIQUE")
    repaired = original.replace(before, BASELINE_REPAIR["replacement"].encode())
    if hashlib.sha256(repaired).hexdigest() != BASELINE_REPAIR["afterSha256"]:
        raise ValueError("BASELINE_REPAIR_OUTPUT_MISMATCH")
    try:
        target.write_bytes(repaired)
        yield BASELINE_REPAIR
    finally:
        target.write_bytes(original)


def run(arguments, cwd, **kwargs):
    return subprocess.run(arguments, cwd=cwd, check=True, **kwargs)


def git(root, *arguments):
    return subprocess.check_output(["git", *arguments], cwd=root).decode().strip()


def sources(root, revision):
    return [{"path": name, "sha256": hashlib.sha256(content).hexdigest()}
            for name, (_, content) in sorted(source_tree(root, revision).items())]


def static_inputs_accounted_for(root, revision):
    """Unknown build scripts, env inputs and nonliteral/external includes use Cargo instead."""
    tree = source_tree(root, revision)
    if any(mode not in ("100644", "100755") or name.endswith("/build.rs") for name, (mode, _) in tree.items()):
        return False
    try:
        workspace = tomllib.loads(tree["Cargo.toml"][1].decode())
        if workspace.get("workspace", {}).get("members") != ["apps/api"]:
            return False
        def unsupported(value):
            return isinstance(value, dict) and ("path" in value or "git" in value
                or any(unsupported(item) for item in value.values()))
        for name in ("Cargo.toml", "apps/api/Cargo.toml"):
            config = tomllib.loads(tree[name][1].decode())
            if config.get("package", {}).get("build", False) is not False or unsupported(config):
                return False
        for name, (_, content) in tree.items():
            if not name.endswith(".rs"):
                continue
            text = content.decode()
            for match in re.finditer(r'\b(?:option_)?env\s*!\s*\(\s*([^)]*)\)', text):
                if match[1].strip() != '"CARGO_PKG_VERSION"':
                    return False
            calls = list(re.finditer(r'\b(include(?:_str|_bytes)?)\s*!\s*\(', text))
            literals = list(re.finditer(r'\b(include(?:_str|_bytes)?)\s*!\s*\(\s*"([^"\\]+)"\s*\)', text))
            if len(calls) != len(literals):
                return False
            for match in literals:
                if posixpath.normpath(posixpath.join(posixpath.dirname(name), match[2])) not in tree:
                    return False
            for match in re.finditer(r'#\s*\[\s*path\s*=\s*"([^"\\]+)"\s*\]', text):
                if posixpath.normpath(posixpath.join(posixpath.dirname(name), match[1])) not in tree:
                    return False
    except (KeyError, UnicodeDecodeError, tomllib.TOMLDecodeError):
        return False
    return True


def validated_openapi_bytes(file):
    data = file.read_bytes()
    try:
        document = json.loads(data)
    except (ValueError, UnicodeDecodeError) as error:
        raise ValueError("INVALID_OPENAPI") from error
    if (len(data) > 20 * 1024 * 1024 or not isinstance(document, dict)
            or not re.fullmatch(r"3\.[01]\.\d+", str(document.get("openapi", "")))
            or not isinstance(document.get("info"), dict)
            or not all(isinstance(document["info"].get(key), str) and document["info"][key] for key in ("title", "version"))
            or not isinstance(document.get("paths"), dict) or not document["paths"]):
        raise ValueError("INVALID_OPENAPI")
    def check(value):
        if isinstance(value, dict):
            if "$ref" in value and (not isinstance(value["$ref"], str) or not value["$ref"].startswith("#/")):
                raise ValueError("INVALID_OPENAPI_EXTERNAL_REF")
            for item in value.values():
                check(item)
        elif isinstance(value, list):
            for item in value:
                check(item)
    check(document)
    return data


def reuse_identical_inputs(root, output, manifest):
    rows = manifest.get("candidateSources")
    if (manifest["baselineRevision"] != manifest["eventBaseRevision"] or manifest["initialContract"] is not False
            or manifest["baselineInstrumented"] is not False or "baselineCompilationRepair" in manifest
            or manifest["baselineRevision"] == BASELINE_REPAIR["revision"]
            or not rows or rows != manifest.get("baselineSources") or rows != manifest.get("eventBaseSources")
            or not static_inputs_accounted_for(root, manifest["candidateRevision"])):
        return False
    data = validated_openapi_bytes(output / "candidate.json")
    digest = hashlib.sha256(data).hexdigest()
    # Exclusive creation retains the original capture's refusal to overwrite evidence.
    with (output / "baseline.json").open("xb") as destination:
        destination.write(data)
    manifest["captureMode"] = "identical_api_inputs"
    manifest["historicalCompatibilityVerified"] = False
    manifest["baselineReuseProof"] = {"schemaVersion": "erp-identical-api-inputs/1", "inputPaths": INPUT_PATHS,
        "sourceCount": len(rows), "sourcesSha256": hashlib.sha256("".join(
            f"{row['sha256']}  {row['path']}\n" for row in rows).encode()).hexdigest(),
        "candidateSha256": digest, "inputAudit": "static-rust-inputs/1"}
    manifest["captures"].append({"label": "baseline", "sha256": digest,
                                "producer": "candidate Rust test job; identical API inputs"})
    return True


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
                "baselineInstrumented": False, "captureMode": "historical_rust_test", "baselineSources": sources(root, base),
                "eventBaseSources": sources(root, event_base), "candidateSources": sources(root, revision), "captures": []}
    if reuse_identical_inputs(root, output, manifest):
        manifest["captures"].append({"label": "candidate", "sha256": manifest["baselineReuseProof"]["candidateSha256"],
                                     "producer": "candidate Rust test job"})
        (output / "capture.json").write_text(json.dumps(manifest, indent=2) + "\n")
        return
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
        with baseline_compilation_repair(root, base) as repair:
            if repair:
                manifest["baselineCompilationRepair"] = repair
                manifest["historicalCompatibilityVerified"] = False
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
