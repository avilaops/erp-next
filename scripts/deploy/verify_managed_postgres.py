#!/usr/bin/env python3
"""Exercise managed preflight and a full restore on isolated loopback fixtures."""
import argparse
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
from urllib.parse import quote
import uuid

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('managed_postgres', ROOT / 'deploy/managed-postgres.py')
pg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pg)
REF = 'abcdefghijklmnopqrst'


def verify(port, source):
    suffix = uuid.uuid4().hex
    database, restored, role = 'erp_mgd_' + suffix, 'erp_mgd_restore_' + suffix, 'erp_mgd_app_' + suffix
    password = quote(os.environ.get('PGPASSWORD', 'fixture'), safe='')
    def url(name='postgres', user='postgres'):
        return f'postgresql://{user}:{password}@127.0.0.1:{port}/{name}'
    def command(sql, name='postgres'):
        env = pg.connection_environment(url(name), REF, allow_local=True)
        result = subprocess.run(['psql', '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1'],
                                input=sql, text=True, encoding='utf-8', capture_output=True, env=env, timeout=90)
        if result.returncode:
            raise RuntimeError('Isolated fixture SQL failed: ' + result.stderr[:700])
        return result.stdout
    created = []
    role_created = False
    try:
        command(f'CREATE DATABASE {database};')
        created.append(database)
        command(f'CREATE ROLE {role} LOGIN NOSUPERUSER NOBYPASSRLS;')
        role_created = True
        manifest = pg.migration_manifest(ROOT, source)
        blob = subprocess.check_output(['git', 'archive', source, 'migrations/'], cwd=ROOT)
        with tarfile.open(fileobj=io.BytesIO(blob)) as archive:
            for member in sorted((m for m in archive.getmembers() if m.isfile()), key=lambda m: m.name):
                command('BEGIN;\n' + archive.extractfile(member).read().decode() + '\nCOMMIT;', database)
        # Reproduce SQLx's authoritative ledger for this fixture; no application
        # migration or historical production ledger is changed by this test.
        command('CREATE TABLE _sqlx_migrations(version bigint PRIMARY KEY,description text NOT NULL,'
                'installed_on timestamptz NOT NULL DEFAULT now(),success bool NOT NULL,'
                'checksum bytea NOT NULL,execution_time bigint NOT NULL);', database)
        for version, checksum in manifest.items():
            command(f"INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) "
                    f"VALUES ({version},'isolated fixture',true,decode('{checksum}','hex'),0);", database)
        command("INSERT INTO tenants(legal_name,tax_id) VALUES('Fixture only','fixture-only');"
                "INSERT INTO identities(auth_subject,email,display_name) "
                "VALUES('fixture-only','fixture@example.invalid','Fixture');"
                f'GRANT USAGE ON SCHEMA public TO {role};'
                f'GRANT SELECT,INSERT,UPDATE ON products,parties,sales_orders TO {role};', database)
        snapshot = pg.query_json(url(database), REF, pg.SNAPSHOT_SQL, allow_local=True)
        schema = pg.validate_snapshot(snapshot, manifest, require_data=True)
        # Trust auth is confined to the independently initialized local cluster.
        runtime = pg.query_json(url(database, role), REF, pg.RUNTIME_SQL, allow_local=True)
        pg.validate_runtime_role(runtime)
        command(f'ALTER ROLE {role} BYPASSRLS;')
        unsafe = pg.query_json(url(database, role), REF, pg.RUNTIME_SQL, allow_local=True)
        try:
            pg.validate_runtime_role(unsafe)
        except pg.PreflightError:
            pass
        else:
            raise AssertionError('BYPASSRLS runtime was accepted')
        command(f'ALTER ROLE {role} NOBYPASSRLS;')
        with tempfile.TemporaryDirectory(prefix='erp-managed-restore-') as directory:
            target = Path(directory) / 'full.dump'
            backup = pg.backup_database(url(database), REF, target, allow_local=True)
            command(f'CREATE DATABASE {restored};')
            created.append(restored)
            env = pg.connection_environment(url(restored), REF, allow_local=True)
            result = subprocess.run(['pg_restore', '--exit-on-error', '--no-owner', '--no-privileges',
                                     '--dbname', restored, str(target)], env=env,
                                    capture_output=True, timeout=120)
            if result.returncode:
                raise RuntimeError('Isolated restore failed: ' + result.stderr[:700].decode(errors='replace'))
            after = pg.query_json(url(restored), REF, pg.SNAPSHOT_SQL, allow_local=True)
            pg.validate_snapshot(after, manifest, require_data=True)
            if snapshot != after:
                raise AssertionError('Restored ledger/schema/identity counts differ')
        return {'passed': True, 'migrationCount': len(manifest), 'runtimeRoleSafe': True,
                'privilegedRuntimeRejected': True, 'fullArchiveVerified': True,
                'isolatedRestoreTested': True, 'restoredCountsAndLedgerMatch': True,
                'sourceSha': source, 'fixtureOnly': True, 'productionReady': schema['productionReady']}
    finally:
        # Only unique databases/role generated by this invocation are removed.
        for name in reversed(created):
            command(f'DROP DATABASE {name} WITH (FORCE);')
        if role_created:
            command(f'DROP ROLE IF EXISTS {role};')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=55337)
    parser.add_argument('--source-sha', required=True)
    args = parser.parse_args()
    print(json.dumps(verify(args.port, args.source_sha)))
