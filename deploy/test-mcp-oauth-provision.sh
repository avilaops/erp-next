#!/usr/bin/env bash
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test -n "${TEST_DATABASE_URL:-}"
checksum=$(sha384sum migrations/202611060001_mcp_oauth.sql | cut -d ' ' -f 1)
psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE erp_next_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE TABLE public._sqlx_migrations (
 version bigint PRIMARY KEY,description text NOT NULL,installed_on timestamptz NOT NULL DEFAULT now(),
 success boolean NOT NULL,checksum bytea NOT NULL,execution_time bigint NOT NULL);
INSERT INTO public._sqlx_migrations(version,description,success,checksum,execution_time)
 VALUES(202611050002,'historical fixture',true,decode('01','hex'),0);
SQL
psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -v "mcp_checksum=$checksum" -f deploy/provision-mcp-oauth.sql
psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO mcp_oauth_clients(id,name,redirects,auth_method)
 VALUES('ci-fixture','CI fixture','["https://client.example/callback"]','none');
SQL
psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -v "mcp_checksum=$checksum" -f deploy/provision-mcp-oauth.sql
psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM public._sqlx_migrations) <> 2 THEN RAISE EXCEPTION 'unexpected migration history'; END IF;
 IF (SELECT encode(checksum,'hex') FROM public._sqlx_migrations WHERE version=202611050002) <> '01'
   THEN RAISE EXCEPTION 'historical checksum changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM mcp_oauth_clients WHERE id='ci-fixture')
   THEN RAISE EXCEPTION 'rerun lost client data'; END IF;
 IF EXISTS(SELECT 1 FROM (VALUES
   ('mcp_oauth_clients','SELECT'),('mcp_oauth_clients','INSERT'),
   ('mcp_oauth_grants','SELECT'),('mcp_oauth_grants','INSERT'),('mcp_oauth_grants','UPDATE'),
   ('mcp_oauth_tokens','SELECT'),('mcp_oauth_tokens','INSERT'),('mcp_oauth_tokens','UPDATE'),
   ('mcp_oauth_codes','SELECT'),('mcp_oauth_codes','INSERT'),('mcp_oauth_codes','UPDATE')
   ) AS rights(table_name,privilege) WHERE NOT has_table_privilege('erp_next_app',table_name,privilege))
   THEN RAISE EXCEPTION 'runtime role lacks OAuth privileges'; END IF;
END $$;
UPDATE public._sqlx_migrations SET checksum=decode('02','hex') WHERE version=202611060001;
SQL
if psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -v "mcp_checksum=$checksum" -f deploy/provision-mcp-oauth.sql; then
  echo 'ERROR: provisioning accepted a different OAuth checksum'
  exit 1
fi
test "$(psql "$TEST_DATABASE_URL" -X -At -c "SELECT encode(checksum,'hex') FROM public._sqlx_migrations WHERE version=202611060001")" = 02
echo 'PASS: atomic OAuth provisioning, idempotence, preserved historical checksum, runtime grants, mismatch refusal.'
