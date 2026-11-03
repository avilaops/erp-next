\set ON_ERROR_STOP on
BEGIN;
REVOKE UPDATE, DELETE ON fiscal_cte_commercial_links, fiscal_cte_commercial_unlinks FROM erp_next_app;
GRANT SELECT, INSERT ON fiscal_cte_commercial_links, fiscal_cte_commercial_unlinks TO erp_next_app;
COMMIT;
