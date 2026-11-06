-- Run only by the GitHub CI provisioning job against the approved release.
-- OAuth tables are independent of the historical business migrations.
-- Never rewrite an old checksum or claim the old history is reconciled.
\set ON_ERROR_STOP on
BEGIN;
LOCK TABLE public._sqlx_migrations IN EXCLUSIVE MODE;

SELECT EXISTS (SELECT 1 FROM public._sqlx_migrations WHERE version=202611060001) AS mcp_recorded \gset
\if :mcp_recorded
  SELECT success AND checksum=decode(:'mcp_checksum','hex') AS mcp_valid
  FROM public._sqlx_migrations WHERE version=202611060001 \gset
  \if :mcp_valid
    \echo OAuth migration already matches the approved source.
  \else
    DO $$ BEGIN RAISE EXCEPTION 'OAuth migration history differs; refusing to change it'; END $$;
  \endif
\else
  SELECT to_regclass('public.mcp_oauth_clients') IS NULL
     AND to_regclass('public.mcp_oauth_grants') IS NULL
     AND to_regclass('public.mcp_oauth_codes') IS NULL
     AND to_regclass('public.mcp_oauth_tokens') IS NULL AS mcp_clean \gset
  \if :mcp_clean
    \ir ../migrations/202611060001_mcp_oauth.sql
    INSERT INTO public._sqlx_migrations(version,description,success,checksum,execution_time)
    VALUES(202611060001,'mcp oauth',true,decode(:'mcp_checksum','hex'),
      (extract(epoch FROM clock_timestamp()-transaction_timestamp())*1000000000)::bigint);
  \else
    DO $$ BEGIN RAISE EXCEPTION 'OAuth objects exist without the approved migration record'; END $$;
  \endif
\endif
\ir grant-mcp-oauth.sql
COMMIT;
