import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[2] / 'deploy' / 'managed-postgres.py'
spec = importlib.util.spec_from_file_location('managed_postgres', MODULE)
pg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pg)
REF = 'abcdefghijklmnopqrst'
URL = f'postgresql://erp_next_app:never-print-me@db.{REF}.supabase.co:5432/postgres'
SHA = 'a' * 40
CHECKSUM = hashlib.sha384(b'CREATE TABLE test(id int);\n').hexdigest()
MANIFEST = {202611130001: CHECKSUM}


def snapshot():
    return {'ledger': [{'version': 202611130001, 'checksum': CHECKSUM, 'success': True}],
            'tables': list(pg.CORE_TABLES), 'counts': {'tenants': 1, 'identities': 2},
            'countsVerified': True}


class ConnectionTests(unittest.TestCase):
    def test_supabase_direct_and_session_keep_password_out_of_argv(self):
        env = pg.connection_environment(URL, REF)
        self.assertEqual(env['PGHOST'], f'db.{REF}.supabase.co')
        self.assertEqual(env['PGPASSWORD'], 'never-print-me')
        self.assertEqual(env['PGSSLMODE'], 'verify-full')
        self.assertEqual(env['PGCLIENTENCODING'], 'UTF8')
        session = URL.replace('erp_next_app:', f'erp_next_app.{REF}:').replace(f'db.{REF}.supabase.co', 'aws-0-sa-east-1.pooler.supabase.com')
        self.assertEqual(pg.connection_environment(session, REF)['PGPORT'], '5432')

    def test_encoded_password_and_username_are_preserved(self):
        env = pg.connection_environment(URL.replace('never-print-me', 'a%40b%3Ac%2F%24%23'), REF)
        self.assertEqual(env['PGPASSWORD'], 'a@b:c/$#')

    def test_rejects_foreign_hosts_projects_transaction_pooling_and_weak_tls(self):
        invalid = [URL.replace(REF, 'z' * 20), URL.replace('.supabase.co', '.supabase.co.evil.invalid'),
                   URL.replace(':5432', ':6543'), URL + '?sslmode=disable', URL + '?sslmode=require',
                   URL + '?sslmode=verify-full&sslmode=disable', URL + '?options=-c%20role=postgres',
                   URL + '#fragment', URL.replace('postgresql:', 'http:')]
        for url in invalid:
            with self.subTest(url=url.replace('never-print-me', 'redacted')):
                with self.assertRaises(pg.PreflightError) as caught:
                    pg.connection_environment(url, REF)
                self.assertNotIn('never-print-me', str(caught.exception))

    def test_local_connection_requires_explicit_opt_in(self):
        local = 'postgresql://fixture:password@127.0.0.1:5432/fixture'
        with self.assertRaises(pg.PreflightError):
            pg.connection_environment(local, REF)
        env = pg.connection_environment(local, REF, allow_local=True)
        self.assertEqual(env['PGSSLMODE'], 'disable')
        self.assertNotIn('PGSSLROOTCERT', env)

    def test_psql_uses_clean_environment_and_redacts_failures(self):
        calls = []
        def run(args, **kwargs):
            calls.append((args, kwargs))
            return subprocess.CompletedProcess(args, 1, '', 'never-print-me: database failure')
        with self.assertRaises(pg.PreflightError) as caught:
            pg.query_json(URL, REF, 'SELECT 1', run=run)
        self.assertNotIn('never-print-me', str(caught.exception))
        self.assertNotIn('never-print-me', json.dumps(calls[0][0]))
        self.assertEqual(calls[0][1]['env']['PGPASSWORD'], 'never-print-me')
        self.assertNotIn('DATABASE_URL', calls[0][1]['env'])


class RecoveryTests(unittest.TestCase):
    def test_valid_current_ledger_and_data_are_separate_proofs(self):
        proof = pg.validate_snapshot(snapshot(), MANIFEST)
        self.assertTrue(proof['schemaReady'])
        self.assertTrue(proof['hasBusinessData'])
        self.assertFalse(proof['productionReady'])

    def test_empty_or_rls_hidden_counts_cannot_be_called_recovered(self):
        for counts, verified in [({'tenants': 0, 'identities': 0}, True), ({'tenants': 1, 'identities': 2}, False)]:
            value = snapshot()
            value.update(counts=counts, countsVerified=verified)
            with self.assertRaises(pg.PreflightError):
                pg.validate_snapshot(value, MANIFEST, require_data=True)

    def test_rejects_foreign_failed_changed_duplicate_or_incomplete_ledger(self):
        for ledger in [[{'version': 1, 'success': True, 'checksum': CHECKSUM}],
                       [{'version': 202611130001, 'success': False, 'checksum': CHECKSUM}],
                       [{'version': 202611130001, 'success': True, 'checksum': '0' * 96}],
                       snapshot()['ledger'] * 2, []]:
            value = snapshot()
            value['ledger'] = ledger
            with self.subTest(ledger=ledger):
                with self.assertRaises(pg.PreflightError):
                    pg.validate_snapshot(value, MANIFEST)

    def test_missing_current_tables_rejects_legacy_erp(self):
        value = snapshot()
        value['tables'].remove('order_supporting_documents')
        with self.assertRaises(pg.PreflightError):
            pg.validate_snapshot(value, MANIFEST)

    def test_runtime_role_must_not_own_tables_bypass_rls_or_read_migrations(self):
        role = {'superuser': False, 'bypassRls': False, 'ownsAppTables': False,
                'canReadLedger': False, 'canWriteApp': True, 'canAssumePrivilegedRole': False}
        self.assertTrue(pg.validate_runtime_role(role)['runtimeRoleSafe'])
        for key in ['superuser', 'bypassRls', 'ownsAppTables', 'canReadLedger', 'canAssumePrivilegedRole']:
            with self.subTest(key=key):
                with self.assertRaises(pg.PreflightError):
                    pg.validate_runtime_role({**role, key: True})
        with self.assertRaises(pg.PreflightError):
            pg.validate_runtime_role({**role, 'canWriteApp': False})

    def test_migration_hashes_come_from_exact_git_blobs_not_crlf_checkout(self):
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode='w') as tar:
            blob = b'CREATE TABLE test(id int);\n'
            member = tarfile.TarInfo('migrations/202611130001_fixture.sql')
            member.size = len(blob)
            tar.addfile(member, io.BytesIO(blob))
        def run(args, **kwargs):
            self.assertEqual(args, ['git', 'archive', SHA, 'migrations/'])
            return subprocess.CompletedProcess(args, 0, archive.getvalue(), b'')
        self.assertEqual(pg.migration_manifest(Path('.'), SHA, run=run), MANIFEST)


class BackupTests(unittest.TestCase):
    def test_full_backup_uses_file_stream_and_verifies_archive_inventory(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'database.dump'
            calls = []
            def run(args, **kwargs):
                calls.append((args, kwargs))
                if args[0] == 'pg_dump':
                    kwargs['stdout'].write(b'PGDMP\x01fixture full database')
                    return subprocess.CompletedProcess(args, 0, None, b'')
                return subprocess.CompletedProcess(args, 0, b'TABLE DATA public _sqlx_migrations\nTABLE DATA public sales_orders\n', b'')
            proof = pg.backup_database(URL, REF, target, run=run)
            self.assertEqual(proof['sha256'], hashlib.sha256(target.read_bytes()).hexdigest())
            self.assertFalse(proof['restoreTested'])
            self.assertNotIn('--schema-only', calls[0][0])
            self.assertNotIn('--data-only', calls[0][0])
            self.assertNotIn('never-print-me', json.dumps([args for args, _ in calls]))
            self.assertEqual(list(Path(directory).glob('*.partial')), [])

    def test_dump_failure_or_missing_ledger_removes_only_own_partial_output(self):
        for failure in ['dump', 'inventory']:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                target = Path(directory) / 'database.dump'
                unrelated = Path(directory) / 'keep.txt'
                unrelated.write_text('preserve')
                def run(args, **kwargs):
                    if args[0] == 'pg_dump':
                        kwargs['stdout'].write(b'PGDMP incomplete')
                        return subprocess.CompletedProcess(args, int(failure == 'dump'), None, b'never-print-me')
                    return subprocess.CompletedProcess(args, 0, b'TABLE public legacy_table', b'')
                with self.assertRaises(pg.PreflightError):
                    pg.backup_database(URL, REF, target, run=run)
                self.assertFalse(target.exists())
                self.assertEqual(unrelated.read_text(), 'preserve')
                self.assertEqual(len(list(Path(directory).iterdir())), 1)

    def test_existing_backup_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'database.dump'
            target.write_bytes(b'keep existing backup')
            with self.assertRaises(pg.PreflightError):
                pg.backup_database(URL, REF, target, run=lambda *a, **k: self.fail('must not invoke pg_dump'))
            self.assertEqual(target.read_bytes(), b'keep existing backup')


if __name__ == '__main__':
    unittest.main()
