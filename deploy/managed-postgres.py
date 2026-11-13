#!/usr/bin/env python3
"""Read-only managed PostgreSQL checks and full, credential-safe client backups."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile
from urllib.parse import parse_qsl, unquote, urlsplit

CORE_TABLES = ('tenants', 'identities', 'products', 'parties', 'sales_orders',
               'receivable_payments', 'commercial_contracts', 'fiscal_nfe_documents',
               'order_supporting_documents', '_sqlx_migrations')


class PreflightError(RuntimeError):
    """A public-safe failure. Never attach raw libpq/URI diagnostics."""


def connection_environment(url, project_ref, *, allow_local=False):
    try:
        if not re.fullmatch(r'[a-z0-9]{20}', project_ref):
            raise ValueError()
        value = urlsplit(url)
        pairs = parse_qsl(value.query, keep_blank_values=True, strict_parsing=True)
        params = dict(pairs)
        if (value.scheme not in ('postgres', 'postgresql') or value.fragment
                or len(params) != len(pairs)
                or set(params) - {'sslmode', 'sslrootcert', 'application_name'}
                or not value.username or not value.password
                or not value.path.startswith('/') or '/' in value.path[1:]):
            raise ValueError()
        host, port = value.hostname, value.port or 5432
        user, password = unquote(value.username), unquote(value.password)
        database = unquote(value.path[1:])
        local = host in ('127.0.0.1', 'localhost', '::1')
        if not database or '\0' in user + password + database:
            raise ValueError()
        if local:
            if not allow_local:
                raise ValueError()
            sslmode = params.get('sslmode', 'disable')
            if not 1 <= port <= 65535:
                raise ValueError()
        else:
            direct = host == f'db.{project_ref}.supabase.co'
            session = (host is not None
                       and re.fullmatch(r'aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com', host)
                       and user.endswith('.' + project_ref))
            if not (direct or session) or port != 5432:
                raise ValueError()
            sslmode = params.get('sslmode', 'verify-full')
            if sslmode != 'verify-full':
                raise ValueError()
        env = {key: os.environ[key] for key in ('PATH', 'SystemRoot', 'WINDIR', 'HOME',
                'USERPROFILE', 'APPDATA', 'SSL_CERT_FILE', 'SSL_CERT_DIR') if key in os.environ}
        env.update(PGHOST=host, PGPORT=str(port), PGDATABASE=database, PGUSER=user,
                   PGPASSWORD=password, PGSSLMODE=sslmode,
                   PGCONNECT_TIMEOUT='10', PGAPPNAME='erp-next-managed-preflight', PGCLIENTENCODING='UTF8',
                   PGOPTIONS='-c statement_timeout=15000 -c lock_timeout=5000')
        if sslmode == 'verify-full':
            env['PGSSLROOTCERT'] = params.get('sslrootcert', 'system')
        return env
    except (ValueError, TypeError, AttributeError):
        raise PreflightError('Invalid PostgreSQL endpoint, project identity or TLS configuration') from None


def query_json(url, project_ref, query, *, allow_local=False, run=subprocess.run):
    env = connection_environment(url, project_ref, allow_local=allow_local)
    try:
        result = run(['psql', '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1'],
                     input=query, text=True, encoding='utf-8', capture_output=True, env=env, timeout=30, check=False)
        if result.returncode:
            raise PreflightError('PostgreSQL preflight query failed; check credentials, schema and access')
        return json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        raise PreflightError('PostgreSQL preflight failed; no activation was performed') from None


def migration_manifest(repository, source_sha, *, run=subprocess.run):
    if not re.fullmatch(r'[a-f0-9]{40}', source_sha):
        raise PreflightError('Expected an exact reviewed source SHA')
    try:
        result = run(['git', 'archive', source_sha, 'migrations/'], cwd=repository,
                     capture_output=True, check=False, timeout=30)
        if result.returncode:
            raise ValueError()
        manifest = {}
        with tarfile.open(fileobj=io.BytesIO(result.stdout), mode='r:') as archive:
            for member in archive:
                if member.isdir():
                    continue
                match = re.fullmatch(r'migrations/(\d{12})_[a-z0-9_]+\.sql', member.name)
                if not member.isfile() or not match or member.size > 4 * 1024 * 1024:
                    raise ValueError()
                version = int(match[1])
                if version in manifest:
                    raise ValueError()
                # SQLx hashes the exact UTF-8 SQL with SHA-384. Git blobs are the
                # Linux build input, independent of a Windows CRLF checkout.
                sql = archive.extractfile(member).read()
                sql.decode('utf-8')
                manifest[version] = hashlib.sha384(sql).hexdigest()
        if not manifest:
            raise ValueError()
        return manifest
    except (OSError, subprocess.SubprocessError, ValueError, tarfile.TarError, UnicodeError):
        raise PreflightError('Cannot verify migrations from the reviewed source revision') from None


def validate_snapshot(value, manifest, *, require_data=False):
    try:
        ledger = value['ledger']
        seen = set()
        for item in ledger:
            version = item['version']
            if (type(version) is not int or version in seen or item['success'] is not True
                    or item['checksum'] != manifest.get(version)):
                raise ValueError()
            seen.add(version)
        if seen != set(manifest) or not set(CORE_TABLES).issubset(value['tables']):
            raise ValueError()
        counts = value['counts']
        has_data = (value.get('countsVerified') is True
                    and all(type(counts.get(key)) is int and counts[key] > 0
                            for key in ('tenants', 'identities')))
        if require_data and not has_data:
            raise ValueError()
        return {'schemaReady': True, 'migrationCount': len(seen), 'hasBusinessData': has_data,
                'productionReady': False,
                'recoveryReconciliationRequired': True}
    except (KeyError, TypeError, ValueError):
        raise PreflightError('Current ERP schema, migration checksums or visible business data are not verified') from None


def validate_runtime_role(value):
    forbidden = ('superuser', 'bypassRls', 'ownsAppTables', 'canReadLedger', 'canAssumePrivilegedRole')
    if any(value.get(key) is not False for key in forbidden) or value.get('canWriteApp') is not True:
        raise PreflightError('Runtime role must be restricted, non-owner and separate from migration credentials')
    return {'runtimeRoleSafe': True}


SNAPSHOT_SQL = """
BEGIN READ ONLY;
SET LOCAL row_security=off;
SELECT json_build_object(
 'tables',(SELECT json_agg(c.relname ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind IN ('r','p')),
 'ledger',(SELECT json_agg(json_build_object('version',version,'success',success,
                  'checksum',encode(checksum,'hex')) ORDER BY version) FROM public._sqlx_migrations),
 'counts',json_build_object('tenants',(SELECT count(*) FROM public.tenants),
                           'identities',(SELECT count(*) FROM public.identities)),
 'countsVerified',true);
ROLLBACK;
"""

RUNTIME_SQL = """
BEGIN READ ONLY;
SELECT json_build_object(
 'superuser',r.rolsuper,'bypassRls',r.rolbypassrls,
 'ownsAppTables',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','system_config','legacy_evolution')
      AND c.relkind IN ('r','p') AND c.relowner=r.oid),
 'canReadLedger',has_table_privilege(current_user,'public._sqlx_migrations','SELECT'),
 'canAssumePrivilegedRole',EXISTS(SELECT 1 FROM pg_roles p WHERE p.oid<>r.oid
      AND pg_has_role(current_user,p.oid,'MEMBER') AND (p.rolsuper OR p.rolbypassrls OR EXISTS(
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','system_config','legacy_evolution') AND c.relowner=p.oid))),
 'canWriteApp',(SELECT bool_and(has_table_privilege(current_user,'public.'||t,p))
      FROM unnest(ARRAY['sales_orders','products','parties']) t
      CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE']) p))
FROM pg_roles r WHERE r.rolname=current_user;
ROLLBACK;
"""


def backup_database(url, project_ref, destination, *, allow_local=False, run=subprocess.run):
    env = connection_environment(url, project_ref, allow_local=allow_local)
    target = Path(destination).absolute()
    if target.exists() or target.is_symlink() or not target.parent.is_dir():
        raise PreflightError('Backup destination must be a new file in an existing private directory')
    partial = None
    try:
        descriptor, name = tempfile.mkstemp(prefix='.' + target.name + '.', suffix='.partial', dir=target.parent)
        partial = Path(name)
        # Full archive: no schema/data/table filters. Stream directly to disk.
        dump_env = {**env, 'PGOPTIONS': '-c statement_timeout=0 -c lock_timeout=5000'}
        with os.fdopen(descriptor, 'wb') as output:
            result = run(['pg_dump', '-w', '--format=custom', '--no-owner', '--no-privileges'],
                         stdout=output, stderr=subprocess.PIPE, env=dump_env, timeout=3600, check=False)
            output.flush()
            os.fsync(output.fileno())
        if result.returncode:
            raise ValueError()
        with partial.open('rb') as archive:
            if archive.read(5) != b'PGDMP':
                raise ValueError()
        inventory = run(['pg_restore', '--list', str(partial)], capture_output=True,
                        env=env, timeout=30, check=False)
        if inventory.returncode or not all(name.encode() in inventory.stdout
                                          for name in ('TABLE DATA', '_sqlx_migrations', 'sales_orders')):
            raise ValueError()
        digest = hashlib.sha256()
        with partial.open('rb') as archive:
            for chunk in iter(lambda: archive.read(1024 * 1024), b''):
                digest.update(chunk)
        size = partial.stat().st_size
        # link() is exclusive on POSIX and Windows; rename/replace could silently
        # overwrite an existing backup created by another concurrent operator.
        os.link(partial, target)
        return {'file': target.name, 'bytes': size, 'sha256': digest.hexdigest(),
                'format': 'pg_dump-custom-full', 'archiveInventoryVerified': True, 'restoreTested': False}
    except (OSError, subprocess.SubprocessError, ValueError):
        raise PreflightError('Full backup failed; no successful backup was published') from None
    finally:
        if partial is not None:
            partial.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('preflight', 'backup'))
    parser.add_argument('--project-ref', required=True)
    parser.add_argument('--source-sha', required=True)
    parser.add_argument('--repository', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--allow-local-validation', action='store_true')
    parser.add_argument('--require-data', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        migration_url = os.environ.get('DATABASE_MIGRATION_URL', '')
        runtime_url = os.environ.get('DATABASE_URL', '')
        if not migration_url or not runtime_url or migration_url == runtime_url:
            raise PreflightError('Separate DATABASE_MIGRATION_URL and DATABASE_URL are required')
        options = {'allow_local': args.allow_local_validation}
        manifest = migration_manifest(args.repository, args.source_sha)
        proof = validate_snapshot(query_json(migration_url, args.project_ref, SNAPSHOT_SQL, **options),
                                  manifest, require_data=args.require_data)
        proof.update(validate_runtime_role(query_json(runtime_url, args.project_ref, RUNTIME_SQL, **options)))
        proof['sourceSha'] = args.source_sha
        if args.command == 'backup':
            if args.output is None:
                raise PreflightError('A new private backup output file is required')
            proof['backup'] = backup_database(migration_url, args.project_ref, args.output, **options)
        print(json.dumps(proof))
        return 0
    except PreflightError as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
