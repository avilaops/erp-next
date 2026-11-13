\set ON_ERROR_STOP on
BEGIN;
REVOKE DELETE ON sales_order_email_deliveries, sales_proposal_email_deliveries FROM erp_next_app;
GRANT SELECT, INSERT, UPDATE ON sales_order_email_deliveries, sales_proposal_email_deliveries TO erp_next_app;
COMMIT;
