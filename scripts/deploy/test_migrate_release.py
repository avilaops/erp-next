import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[2] / "deploy" / "migrate-release.py"
spec = importlib.util.spec_from_file_location("release_migration", MODULE)
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)
SHA = "a" * 40


class FakeRuntime:
    def __init__(self, fail=None, database="erp_next"):
        self.calls = []
        self.fail = fail
        self.database = database

    def __call__(self, args, **kwargs):
        self.calls.append((args, kwargs))
        if args[:2] == ["docker", "inspect"]:
            output = json.dumps([f"DATABASE_URL=postgresql://runtime:SENSITIVE@host.docker.internal/{self.database}"])
        elif args[:3] == ["docker", "image", "inspect"]:
            output = "sha256:" + "b" * 64
        elif args[:2] == ["id", "-u"]:
            output = "111"
        elif "pg_dump" in args:
            output = "-- Backup\nCREATE TABLE fixture ();\n" if "--schema-only" in args else "INSERT INTO _sqlx_migrations VALUES (1);\n"
        elif "psql" in args:
            output = json.dumps([{"version": 1, "success": True, "checksum": "c" * 96}])
        else:
            output = "migrations applied"
        failed = self.fail == "backup" and "pg_dump" in args or self.fail == "migrate" and args[:2] == ["docker", "run"]
        return subprocess.CompletedProcess(args, int(failed), output, "SENSITIVE private diagnostic" if failed else "")


class ReleaseMigrationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.release = self.root / "releases" / SHA
        self.release.mkdir(parents=True)
        self.runtime = FakeRuntime()

    def migrate(self):
        return migration.migrate_release(SHA, self.release, root=self.root, run=self.runtime)

    def test_backup_and_ledger_precede_exact_image_migration_without_building_or_activating_services(self):
        proof = self.migrate()
        commands = [args for args, _ in self.runtime.calls]
        apply_index = next(i for i, args in enumerate(commands) if args[:2] == ["docker", "run"])
        self.assertEqual(sum("pg_dump" in args for args in commands[:apply_index]), 2)
        self.assertIn("erp-next-api:sha-" + SHA, commands[apply_index])
        self.assertEqual(commands[apply_index][-1], "migrate")
        self.assertIn("none", commands[apply_index])
        self.assertIn("--read-only", commands[apply_index])
        self.assertNotIn("SENSITIVE", json.dumps(commands))
        self.assertFalse(any("build" in args or "up" in args for args in commands))
        self.assertTrue(proof["applied"])
        self.assertTrue((self.root / "private" / ("migration-" + SHA) / "verification.json").exists())

    def test_backup_failure_stops_before_any_migration(self):
        self.runtime.fail = "backup"
        with self.assertRaisesRegex(RuntimeError, "backup"):
            self.migrate()
        self.assertFalse(any(args[:2] == ["docker", "run"] for args, _ in self.runtime.calls))

    def test_failed_migration_keeps_private_diagnostic_and_never_claims_success(self):
        self.runtime.fail = "migrate"
        with self.assertRaisesRegex(RuntimeError, "migration") as error:
            self.migrate()
        self.assertNotIn("SENSITIVE", str(error.exception))
        private = self.root / "private" / ("migration-" + SHA)
        self.assertIn("SENSITIVE", (private / "migration.log").read_text())
        self.assertFalse((private / "verification.json").exists())

    def test_existing_backup_is_never_overwritten(self):
        self.migrate()
        before = len(self.runtime.calls)
        with self.assertRaisesRegex(RuntimeError, "exists"):
            self.migrate()
        self.assertEqual(len(self.runtime.calls), before)

    def test_foreign_database_is_rejected_before_backup_or_apply(self):
        self.runtime.database = "another_product"
        with self.assertRaisesRegex(RuntimeError, "database"):
            self.migrate()
        self.assertFalse(any("pg_dump" in args or args[:2] == ["docker", "run"] for args, _ in self.runtime.calls))

    def test_invalid_sha_and_paths_are_rejected_before_running_commands(self):
        for sha, release in [("../bad", self.release), (SHA, self.root / "elsewhere")]:
            with self.assertRaises(ValueError):
                migration.migrate_release(sha, release, root=self.root, run=self.runtime)
        self.assertEqual(self.runtime.calls, [])

    def test_dispatcher_migrates_before_installing_activation_rollback_or_starting_services(self):
        source = (MODULE.parent / "production-deploy.sh").read_text()
        migration_index = source.index('python3 "$release/migrate-release.py"')
        self.assertLess(migration_index, source.index("trap rollback ERR"))
        self.assertLess(migration_index, source.index('compose "$release" up'))


if __name__ == "__main__":
    unittest.main()
