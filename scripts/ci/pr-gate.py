#!/usr/bin/env python3
"""Plan bounded PR checks and attest their exact outcomes; fail closed."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

DOMAINS = ("web", "api", "fiscal")


def plan(paths):
    scope = dict.fromkeys(DOMAINS, False)
    for path in paths:
        if path.startswith(("docs/", "context/")) or ("/" not in path and path.endswith(".md")):
            continue
        if path.startswith(("apps/web/", "packages/")):
            scope["web"] = True
        elif path.startswith(("apps/api/", "migrations/", "queries/")) or path in (
            "Cargo.toml", "Cargo.lock", "rust-toolchain.toml"
        ):
            scope["api"] = True
        elif path.startswith(("apps/fiscal-engine/", "apps/fiscal-mcp/", "scripts/fiscal/", "integrations/fiscal/")):
            scope["fiscal"] = True
        else:
            # Unknown/new infrastructure must not silently bypass validation.
            scope = dict.fromkeys(DOMAINS, True)
    return scope


def verdict(jobs):
    if not isinstance(jobs, dict) or set(jobs) != {"changes", *DOMAINS}:
        raise ValueError("Missing or unexpected validation jobs")
    changes = jobs["changes"]
    outputs = changes.get("outputs", {})
    if set(outputs) != set(DOMAINS) or any(value not in ("true", "false") for value in outputs.values()):
        raise ValueError("Missing or invalid scope")
    scope = {key: outputs[key] == "true" for key in DOMAINS}
    outcomes = {key: value["result"] for key, value in jobs.items()}
    passed = changes["result"] == "success" and all(
        outcomes[key] == ("success" if scope[key] else "skipped") for key in DOMAINS
    )
    return passed, scope, outcomes


def attest(jobs, env):
    passed, scope, outcomes = verdict(jobs)
    for key in ("SOURCE_HEAD_SHA", "GITHUB_SHA"):
        if not re.fullmatch(r"[a-f0-9]{40}", env[key]):
            raise ValueError(f"Invalid {key}")
    data = {
        "schema": "avila-mlops-ci-attestation/2",
        "repository": env["GITHUB_REPOSITORY"],
        "sourceSha": env["SOURCE_HEAD_SHA"],
        "testedSha": env["GITHUB_SHA"],
        "workflow": env["GITHUB_WORKFLOW"],
        "event": env["GITHUB_EVENT_NAME"],
        "runId": int(env["GITHUB_RUN_ID"]),
        "runAttempt": int(env["GITHUB_RUN_ATTEMPT"]),
        "ciGate": "passed" if passed else "failed",
        "validationScope": scope,
        "validationJobs": outcomes,
        "note": "Scoped PR checks only; skipped domains were not tested. No production or full regression attestation.",
    }
    data["evidenceSha256"] = hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return data


def main():
    if sys.argv[1] == "plan":
        paths = subprocess.check_output([
            "git", "diff", "--name-only", "--no-renames", "-z", os.environ["BASE_SHA"], "HEAD"
        ]).decode().split("\0")
        scope = plan([path for path in paths if path])
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            for domain, selected in scope.items():
                output.write(f"{domain}={str(selected).lower()}\n")
        print(json.dumps(scope, sort_keys=True))
    elif sys.argv[1] == "gate":
        data = attest(json.loads(os.environ["VALIDATION_JOBS"]), os.environ)
        target = Path(sys.argv[2])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        print(data["ciGate"], json.dumps(data["validationJobs"], sort_keys=True))
        return 0 if data["ciGate"] == "passed" else 1
    else:
        raise ValueError("Expected plan or gate")
    return 0


if __name__ == "__main__":
    sys.exit(main())
