\set ON_ERROR_STOP on
BEGIN;
REVOKE DELETE ON sales_proposals, sales_proposal_versions FROM erp_next_app;
GRANT SELECT, INSERT, UPDATE ON sales_proposals, sales_proposal_versions TO erp_next_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sales_proposal_lines TO erp_next_app;
COMMIT;
