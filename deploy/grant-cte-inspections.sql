\set ON_ERROR_STOP on
BEGIN;
REVOKE UPDATE, DELETE ON fiscal_cte_inspections FROM erp_next_app;
GRANT SELECT, INSERT ON fiscal_cte_inspections TO erp_next_app;
COMMIT;
