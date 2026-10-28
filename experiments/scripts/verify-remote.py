import json
import sys
import urllib.request
from pathlib import Path

root = Path("/opt/avila-experiments")
credentials = dict(line.split("=", 1) for line in (root / ".env").read_text().splitlines() if "=" in line)
def request(route, body=None):
    headers = {"Authorization": "Bearer " + credentials["LAB_API_TOKEN"]}
    if body is not None:
        headers["Content-Type"] = "application/json"
    query = urllib.request.Request("http://127.0.0.1:3300" + route, headers=headers, data=None if body is None else json.dumps(body).encode())
    with urllib.request.urlopen(query, timeout=30) as response:
        return json.load(response)

if "--create" in sys.argv:
    suite = request("/api/v1/suite")
    assert len(suite["dataset"]["cases"]) == 14
    run = request("/api/v1/runs", {"revision": suite["revision"]})
    (root / "verification-run.json").write_text(json.dumps({"id": run["id"], "hash": run["candidate"]["dataset"]["hash"]}))
    (root / "verification-run.json").chmod(0o600)
    print(json.dumps({"recorded": run["id"], "cases": run["candidate"]["summary"]["total"], "verdict": run["candidate"]["summary"]["verdict"]}))
else:
    reference = json.loads((root / "verification-run.json").read_text())
    run = request("/api/v1/runs/" + reference["id"])
    assert run["candidate"]["dataset"]["hash"] == reference["hash"]
    assert run["candidate"]["summary"]["total"] == 14
    print(json.dumps({"persistence": "passed", "runId": run["id"], "cases": 14}))
