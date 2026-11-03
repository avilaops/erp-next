\set ON_ERROR_STOP on
BEGIN;
REVOKE UPDATE, DELETE ON fiscal_received_nfses FROM erp_next_app;
GRANT SELECT, INSERT ON fiscal_received_nfses TO erp_next_app;
COMMIT;
