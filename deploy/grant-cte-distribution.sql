\set ON_ERROR_STOP on
BEGIN;
REVOKE DELETE ON fiscal_cte_distribution_state, fiscal_cte_distribution_runs FROM erp_next_app;
REVOKE UPDATE, DELETE ON fiscal_cte_distribution_documents FROM erp_next_app;
GRANT SELECT, INSERT, UPDATE ON fiscal_cte_distribution_state,
    fiscal_cte_distribution_runs TO erp_next_app;
GRANT SELECT, INSERT ON fiscal_cte_distribution_documents TO erp_next_app;
COMMIT;
