#!/usr/bin/env python3
"""Apply the candidate image's SQLx migrations before replacing running services."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path("/mnt/HC_Volume_106542212/erp-next")
STATE_SQL = "SELECT COALESCE(json_agg(json_build_object('version',version,'success',success,'checksum',encode(checksum,'hex')) ORDER BY version),'[]'::json) FROM _sqlx_migrations;"


def private_file(path, content):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as output:
        output.write(content)


def migrate_release(sha, release, *, root=ROOT, run=subprocess.run):
    root = Path(root).resolve()
    release = Path(release)
    if not re.fullmatch(r"[0-9a-f]{40}", sha) or release.resolve() != root / "releases" / sha or not release.is_dir():
        raise ValueError("Invalid release revision or directory")
    private_root = root / "private"
    if private_root.resolve() != private_root:
        raise ValueError("Invalid private backup directory")
    private_root.mkdir(mode=0o700, exist_ok=True)
    private = private_root / ("migration-" + sha)
    if private.exists():
        raise RuntimeError("Migration backup already exists; inspect the previous attempt before retrying")
    private.mkdir(mode=0o700)

    def execute(args, stage, **kwargs):
        result = run(args, capture_output=True, text=True, check=False, **kwargs)
        if result.returncode:
            private_file(private / (stage + ".log"), result.stdout + "\n" + result.stderr)
            raise RuntimeError(f"Release {stage} failed; private diagnostic saved")
        return result.stdout.strip()

    image = "erp-next-api:sha-" + sha
    image_id = execute(["docker", "image", "inspect", "--format", "{{.Id}}", image], "image-check")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        raise RuntimeError("Invalid candidate image identity")
    active = json.loads(execute(["docker", "inspect", "--format", "{{json .Config.Env}}", "erp-next-api-1"], "database-check"))
    active_env = dict(entry.split("=", 1) for entry in active if "=" in entry)
    database = urlsplit(active_env.get("DATABASE_URL", ""))
    if unquote(database.path).lstrip("/") != "erp_next" or database.hostname not in {"localhost", "127.0.0.1", "host.docker.internal"}:
        raise RuntimeError("Active database is not the expected local ERP database")

    psql = ["sudo", "-n", "-u", "postgres", "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-d", "erp_next"]

    def state(stage):
        rows = json.loads(execute(psql, stage, input=STATE_SQL))
        if not isinstance(rows, list) or any(not isinstance(row, dict) or row.get("success") is not True or not re.fullmatch(r"[0-9a-f]{96}", str(row.get("checksum", ""))) for row in rows):
            raise RuntimeError("Migration ledger contains an invalid or unsuccessful entry")
        return rows

    before = state("ledger-before")
    private_file(private / "ledger-before.json", json.dumps(before, indent=2) + "\n")
    dump = ["sudo", "-n", "-u", "postgres", "pg_dump", "--no-owner", "--no-privileges"]
    schema = execute(dump + ["--schema-only", "erp_next"], "schema-backup")
    if not schema:
        raise RuntimeError("Empty schema backup; migration was not started")
    private_file(private / "schema-before.sql", schema + "\n")
    ledger = execute(dump + ["--data-only", "--table=public._sqlx_migrations", "--column-inserts", "erp_next"], "ledger-backup")
    if not ledger:
        raise RuntimeError("Empty ledger backup; migration was not started")
    private_file(private / "ledger-before.sql", ledger + "\n")
    pg_uid = execute(["id", "-u", "postgres"], "postgres-user")
    if not pg_uid.isdigit():
        raise RuntimeError("Invalid PostgreSQL operating-system identity")
    command = ["docker", "run", "--rm", "--name", "erp-next-migration-" + sha, "--network", "none", "--read-only",
               "--security-opt", "no-new-privileges:true", "--cap-drop", "ALL", "--pids-limit", "64", "--memory", "256m",
               "--user", pg_uid, "--volume", "/var/run/postgresql:/var/run/postgresql:ro", "--env", "DATABASE_URL", image, "migrate"]
    environment = {**os.environ, "DATABASE_URL": "postgresql://postgres@localhost/erp_next?host=/var/run/postgresql"}
    output = execute(command, "migration", env=environment)
    private_file(private / "migration.log", output + "\n")
    after = state("ledger-after")
    if any(row not in after for row in before):
        raise RuntimeError("Existing migration checksums changed; services must not be activated")
    private_file(private / "ledger-after.json", json.dumps(after, indent=2) + "\n")
    proof = {"sha": sha, "imageId": image_id, "applied": True, "beforeCount": len(before), "afterCount": len(after),
             "schemaBackupSha256": hashlib.sha256((schema + "\n").encode()).hexdigest(), "binaryBuiltOnServer": False}
    private_file(private / "verification.json", json.dumps(proof, indent=2) + "\n")
    return proof


if __name__ == "__main__":
    os.umask(0o077)
    try:
        if len(sys.argv) != 3:
            raise ValueError("Expected revision and release directory")
        print(json.dumps(migrate_release(sys.argv[1], sys.argv[2])))
    except Exception:
        print("ERP migration preflight failed; services were not activated. Inspect the private release diagnostic.", file=sys.stderr)
        sys.exit(1)
