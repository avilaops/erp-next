#!/usr/bin/env python3
"""GitHub Actions CI gate evidence. Records job outcomes, never invents test counts."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys

SCHEMA = "avila-mlops-ci-attestation/1"
SHA = re.compile(r"^[a-f0-9]{40}$")

def attest(jobs, source_sha, repository, run_id, attempt, workflow, event, tested_sha=None):
    if not SHA.fullmatch(source_sha):
        raise ValueError("source_sha must be a full commit SHA")
    if tested_sha is not None and not SHA.fullmatch(tested_sha):
        raise ValueError("tested_sha must be a full commit SHA")
    if not repository.startswith("avilaops/") or "/" not in repository:
        raise ValueError("repository must be in avilaops")
    if not isinstance(jobs, dict) or not jobs:
        raise ValueError("CI dependencies not provided")
    outcomes = {}
    for name, result in sorted(jobs.items()):
        status = result.get("result") if isinstance(result, dict) else None
        if status not in ("success", "failure", "cancelled", "skipped"):
            raise ValueError("Unknown CI dependency outcome")
        outcomes[name] = status
    passed = all(status == "success" for status in outcomes.values())
    payload = {
        "schema": SCHEMA,
        "repository": repository,
        "sourceSha": source_sha,
        "testedSha": tested_sha or source_sha,
        "testTarget": "github-pr-merge-ref" if event == "pull_request" else "source-commit",
        "workflow": workflow,
        "event": event,
        "runId": int(run_id),
        "runAttempt": int(attempt),
        "url": f"https://github.com/{repository}/actions/runs/{run_id}",
        "ciGate": "passed" if passed else "failed",
        "validationJobs": outcomes,
        "testCounts": None,
        "contractVerdict": None,
        "securityVerdict": None,
        "humanApproval": None,
        "deployment": None,
        "postDeployHealth": None,
        "note": "CI job results only; no MLOps, human approval or production-health attestation.",
    }
    payload["evidenceSha256"] = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return payload

def main():
    data = attest(
        json.loads(os.environ["VALIDATION_JOBS"]),
        os.environ["SOURCE_HEAD_SHA"],
        os.environ["GITHUB_REPOSITORY"],
        os.environ["GITHUB_RUN_ID"],
        os.environ["GITHUB_RUN_ATTEMPT"],
        os.environ.get("GITHUB_WORKFLOW", "CI"),
        os.environ["GITHUB_EVENT_NAME"],
        os.environ["GITHUB_SHA"],
    )
    target = Path(sys.argv[1])
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("CI_ATTESTATION", data["ciGate"], "jobs", len(data["validationJobs"]))

if __name__ == "__main__":
    main()
