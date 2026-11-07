\set ON_ERROR_STOP on
GRANT SELECT,INSERT,UPDATE ON commercial_approval_settings,commercial_order_quotes TO erp_next_app;
GRANT SELECT,INSERT ON commercial_approval_decisions TO erp_next_app;
GRANT SELECT,INSERT,UPDATE ON sales_opportunities TO erp_next_app;
