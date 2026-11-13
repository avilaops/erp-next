# Managed PostgreSQL for ERP Next

This path preserves the existing Rust/SQLx API and PostgreSQL schemas. Supabase is
the PostgreSQL host; native API connections use the direct endpoint or Supavisor
**session** mode on port5432. Do not use transaction mode6543 for SQLx migrations
or assume a Workers Hyperdrive binding can be passed to a native process.

## Separate server-only credentials

- `DATABASE_MIGRATION_URL`: administrative/owner connection used by an operator
  for migration, inspection and full backups. Never put this in application env.
- `DATABASE_URL`: restricted runtime role, for example `erp_next_app`; it must
  not own ERP tables, bypass RLS, be superuser, assume privileged roles, or read
  the SQLx migration ledger. Reuse the reviewed runtime grants appropriate to
  the source revision. Do not run `bootstrap.sql` to fabricate recovered tenants
  or identity records.
- `DATABASE_MAX_CONNECTIONS`: start with5 per native instance and account for
  all instances and other Supabase services before raising it.

Get both connection strings through a local secret store or private environment
configuration. The tooling passes connection parameters through libpq environment
variables, not process arguments or reports. Remote connections require
`sslmode=verify-full`; `sslrootcert=system` needs libpq17+ or an explicitly trusted
CA file. Pin PostgreSQL client versions compatible with the source/target version
before backup and restore. A project ref must match the endpoint and session user.
For the native SQLx URL, omit `sslrootcert=system`: SQLx0.8 treats it as a file
path. Use `sslmode=verify-full` with its trusted roots, or a real CA bundle path
present in the reviewed image. The libpq preflight sets PGSSLROOTCERT separately.

## Preflight and full backup

The commands consume credentials already present in the environment. Use the
exact40character source SHA whose API image will be activated:

```text
python deploy/managed-postgres.py preflight --project-ref <ref> --source-sha <sha> --require-data
python deploy/managed-postgres.py backup --project-ref <ref> --source-sha <sha> --require-data --output <private-new-file.dump>
```

The tool reads expected SQLx SHA-384 checksums from the exact Git blobs, so Windows
CRLF conversion does not change the Linux release contract. It checks all required
core tables and an exact successful migration ledger. The administrative count
query uses read-only/row_security=off and must fail instead of misreporting
RLS-hidden records as an empty or recovered database. The runtime query only
checks permissions; it does not require a tenant data context or grant access.

The full custom-format pg_dump streams to an exclusive private partial file,
requires successful exit and pg_restore inventory entries for migration history
and sales orders, and computes SHA-256 before exclusively publishing the file.
An existing backup is never overwritten. Failure removes only its own partial
file. A successful archive is **not** a successful restore test: the JSON keeps
`restoreTested:false` and `productionReady:false`.

For isolated fixtures only, `--allow-local-validation` permits a loopback database;
it does not relax remote endpoint/TLS requirements. Do not apply that option to a
production activation workflow.

## Provisioning and migration sequence

1. Select the authorized organization and quote the actual project cost. Create
   an isolated validation destination first; never route production to an empty DB.
2. Inspect existing schemas, roles, extensions, Data API settings and advisors.
   Preserve public/system_config/legacy_evolution names and existing SQLx history.
   Existing migrations contain explicit public references; changing search_path
   alone does not relocate the ERP safely.
3. Keep ERP tables/functions unavailable to Supabase `anon`, `authenticated` and
   public API users. Disable Data API exposure for the ERP schemas and verify
   effective privileges/default privileges; existing RLS is tied to the API's
   verified `app.tenant_id`/subject context, not Supabase Auth JWT policies. Never
   grant a browser broad table access or replace the policies with auth.uid().
4. Test exact source migrations only against isolated validation data. For a
   recovered destination, preserve roles/objects and the original migration
   ledger, apply only the reviewed release's remaining migrations via the native
   `erp-next-api migrate` command using the migration credential, then validate
   the complete expected ledger. Never run migrations at every container start.
5. Restore a full **current ERP Next** backup into an isolated target and compare
   tenant/identity UUIDs, row counts, financial totals, document bytes/hashes and
   certificate decryption using retained encryption keys. A legacy ERP dump with
   erp_control/tenant_ludus is not a current SQLx ERP Next restore source.
6. Run preflight with separate runtime credentials, real cross-tenant/permission
   tests, a complete restore test and the existing application/fiscal/contracts
   checks. Keep mail, payments, SEFAZ and signature commands disabled in fixtures.
7. Configure bounded native runtime connections and strict TLS. Only promote a
   recovered destination after identity and external service prerequisites pass.
8. Publish encrypted/private full backups to `avilaops-erp-next-backups` with a
   verified offsite restore procedure. The bucket is currently empty and private;
   this guide does not claim that uploads, scheduling or recovery already exist.

## Hyperdrive, cache and Redis

Use the Supabase **direct** connection for an actual Worker Hyperdrive consumer;
Hyperdrive already pools connections. Keep cache disabled for permissions, money,
stock and read-after-write behavior. It never replaces PostgreSQL or a full backup.
The current native API has no Redis dependency. Cloudflare KV is eventually
consistent and is not a substitute for financial/stock transactions; Durable
Objects and Queues are only needed when an identified consumer requires them.
The DocuSeal portal is separate: its upstream runtime/tests include Redis. Do
not remove or replace that dependency based on the ERP API audit. A managed
Redis integration must preserve the portal's actual commands and job semantics.

The existing CI discovers `scripts/deploy/test_managed_postgres.py` automatically.
For an actual full-schema/backup/restore fixture with PostgreSQL clients matching
the loopback server, run:

```text
python -B scripts/deploy/verify_managed_postgres.py --port <isolated-port> --source-sha <sha>
```

This creates uniquely named fixture databases and a restricted role, applies all
reviewed migrations, verifies preflight and rejection of BYPASSRLS, backs up and
restores a complete archive, compares schema/ledger/counts, and removes only its
own databases/role. It never connects to a non-loopback host or changes production.

## Current execution boundary

The user chose avilaops's Org and then directed work to code/tests while servers
are unavailable. No project, paid plan, production restore or identity transition
is performed by these source changes. Source readiness, restored data and live
application availability are separate checks.
