"""Preserve the complete legacy schemas, reconcile rows, then project safe history.

Run against an initialized, unpublished ERP Next database, after stopping legacy
writes. Credentials are environment-only; database contents are never logged.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import uuid

SOURCE = os.environ["ERP_LEGACY_DATABASE_URL"]
TARGET = os.environ["DATABASE_URL"]
TENANT = str(uuid.UUID(os.environ["ERP_BOOTSTRAP_TENANT"]))
SCHEMAS = ("erp_control", "tenant_ludus")


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def identifier(value):
    return '"' + value.replace('"', '""') + '"'


def command(args, *, database, sql=None):
    env = dict(os.environ, PGDATABASE=database, PGOPTIONS="-c timezone=UTC")
    if args[0] in ("psql", "pg_dump"):
        args = [args[0], "--dbname=" + database, *args[1:]]
    result = subprocess.run(args, input=sql, text=True, capture_output=True, env=env)
    if result.returncode:
        # SQL errors can contain customer data or credentials. Keep them private.
        raise RuntimeError(f"{args[0]} failed (exit {result.returncode}); no customer data logged")
    return result.stdout.strip()


def query(database, sql):
    return command(["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"], database=database, sql=sql)


def manifest(database):
    tables = json.loads(query(database, "SELECT coalesce(json_agg(json_build_array(schemaname,tablename) ORDER BY schemaname,tablename),'[]') FROM pg_tables WHERE schemaname IN ('erp_control','tenant_ludus');"))
    result = {}
    for schema, table in tables:
        relation = identifier(schema) + "." + identifier(table)
        result[schema + "." + table] = json.loads(query(database, f"SELECT json_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex')) FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h FROM {relation} t) rows;"))
    return result


def main():
    before = manifest(SOURCE)
    if not before or "tenant_ludus.products" not in before:
        raise RuntimeError("Unexpected legacy database")
    exists = query(TARGET, "SELECT count(*) FROM pg_namespace WHERE nspname IN ('erp_control','tenant_ludus');")
    if exists != "0":
        raise RuntimeError("Target already contains legacy schemas; refusing to overwrite")
    with tempfile.TemporaryDirectory(prefix="erp-migration-") as directory:
        dump = Path(directory) / "legacy.dump"
        command(["pg_dump", "-Fc", "--no-owner", "--no-privileges", "--schema=erp_control", "--schema=tenant_ludus", "-f", str(dump)], database=SOURCE)
        digest = hashlib.file_digest(dump.open("rb"), "sha256").hexdigest()
        command(["pg_restore", "--dbname=" + TARGET, "--no-owner", "--no-privileges", "--exit-on-error", "--single-transaction", str(dump)], database=TARGET)
    copied = manifest(TARGET)
    after = manifest(SOURCE)
    if before != copied or before != after:
        raise RuntimeError("Source changed or imported data differs; do not switch traffic")
    sql = Path("deploy/import-legacy.sql").read_text(encoding="utf-8")
    query(TARGET, "\\set tenant " + literal(TENANT) + "\n\\set manifest " + literal(json.dumps(before)) + "\n" + sql)
    print(json.dumps({"verified": True, "tables": len(before), "rows": sum(item["rows"] for item in before.values()), "dumpSha256": digest, "tenant": TENANT}))


if __name__ == "__main__":
    main()
