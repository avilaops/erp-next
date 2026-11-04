\set ON_ERROR_STOP on
BEGIN;
GRANT USAGE ON SCHEMA system_config,legacy_evolution TO erp_next_app;
GRANT SELECT ON ALL TABLES IN SCHEMA system_config,legacy_evolution TO erp_next_app;
GRANT EXECUTE ON FUNCTION system_config.has_permission(text) TO erp_next_app;
-- No automatic role permissions, DML grants, pricing publication or source access.
COMMIT;
